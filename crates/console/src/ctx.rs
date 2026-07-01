//! Console runtime context: owns the Tokio runtime and the gRPC client, and
//! bridges the synchronous `dialoguer` menu loop to the async RPC calls.
//!
//! The menu code stays fully synchronous; every RPC is driven to completion with
//! `block_on`, so `dialoguer` prompts never contend with an async executor.

use anyhow::{Context, Result};
use tokio::runtime::Runtime;
use tonic::transport::Channel;
use tonic::Request;
use vpn_proto::panel as pb;
use vpn_proto::panel::panel_service_client::PanelServiceClient;

use crate::{token_store, ui};

pub type Client = PanelServiceClient<Channel>;

pub struct Ctx {
    rt: Runtime,
    client: Client,
}

impl Ctx {
    /// Connect to the backend, building the runtime that drives every later RPC.
    pub fn connect(rt: Runtime, server: String) -> Result<Self> {
        let client = rt.block_on(async {
            let channel = Channel::from_shared(server.clone())?
                .connect()
                .await
                .with_context(|| format!("connecting to {server}"))?;
            anyhow::Ok(PanelServiceClient::new(channel))
        })?;
        Ok(Self { rt, client })
    }

    /// Run an RPC closure to completion and return its inner message.
    ///
    /// `f` receives an owned clone of the client (clones are cheap — they share
    /// the underlying channel) and produces the RPC future via an `async move`
    /// block, e.g. `|mut c| async move { c.list_users(req).await }`. Build the
    /// authed request with [`authed`] first.
    pub fn call<F, Fut, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(Client) -> Fut,
        Fut: std::future::Future<Output = Result<tonic::Response<T>, tonic::Status>>,
    {
        let client = self.client.clone();
        let resp = self.rt.block_on(f(client))?;
        Ok(resp.into_inner())
    }

    /// Ensure a valid admin token is stored, prompting for it if not. The token
    /// is the bearer credential itself (there is no session), so a successful
    /// `login` verification just means the stored token is what we keep.
    pub fn ensure_logged_in(&mut self) -> Result<()> {
        // A stored token that still validates lets us skip straight to the menu.
        if token_store::load().is_ok() {
            if let Ok(req) = authed(pb::Empty {}) {
                if self
                    .call(|mut c| async move { c.who_am_i(req).await })
                    .is_ok()
                {
                    return Ok(());
                }
            }
        }

        ui::header("Login");
        loop {
            let token = ui::password("admin token")?;
            let req = Request::new(pb::LoginRequest {
                token: token.clone(),
            });
            match self.call(|mut c| async move { c.login(req).await }) {
                Ok(_) => {
                    token_store::save(&token)?;
                    ui::success("logged in; token stored");
                    return Ok(());
                }
                Err(e) => {
                    ui::error(format!("login failed: {e:#}"));
                    if !ui::confirm("try again?")? {
                        anyhow::bail!("login cancelled");
                    }
                }
            }
        }
    }
}

/// Wrap a message in a `Request` with the stored bearer token attached.
pub fn authed<T>(msg: T) -> Result<Request<T>> {
    let token = token_store::load().context("not logged in")?;
    let mut req = Request::new(msg);
    req.metadata_mut()
        .insert("authorization", format!("Bearer {token}").parse()?);
    Ok(req)
}
