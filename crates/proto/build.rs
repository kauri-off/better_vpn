use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Use a vendored protoc so contributors don't need it installed globally.
    if env::var("PROTOC").is_err() {
        if let Ok(path) = protoc_bin_vendored::protoc_bin_path() {
            // SAFETY: single-threaded build script context.
            env::set_var("PROTOC", path);
        }
    }

    tonic_prost_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&["proto/panel.proto"], &["proto"])?;

    println!("cargo:rerun-if-changed=proto/panel.proto");
    Ok(())
}
