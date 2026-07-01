//! Thin wrappers around `dialoguer` so every page shares one theme and a
//! consistent set of prompts. Keeps the page modules free of prompt boilerplate.

use anyhow::Result;
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Input, Password, Select};

fn theme() -> ColorfulTheme {
    ColorfulTheme::default()
}

/// Render a selectable menu; returns the chosen index, or `None` if the user
/// pressed Esc/q to go back.
pub fn menu(title: &str, items: &[&str]) -> Option<usize> {
    Select::with_theme(&theme())
        .with_prompt(title)
        .items(items)
        .default(0)
        .interact_opt()
        .ok()
        .flatten()
}

/// Free-text input; empty allowed.
pub fn input(prompt: &str) -> Result<String> {
    Ok(Input::<String>::with_theme(&theme())
        .with_prompt(prompt)
        .allow_empty(true)
        .interact_text()?)
}

/// Free-text input pre-filled with `default` (shown, editable).
pub fn input_default(prompt: &str, default: &str) -> Result<String> {
    Ok(Input::<String>::with_theme(&theme())
        .with_prompt(prompt)
        .default(default.to_string())
        .allow_empty(true)
        .interact_text()?)
}

/// Free-text input that rejects an empty value.
pub fn input_required(prompt: &str) -> Result<String> {
    Ok(Input::<String>::with_theme(&theme())
        .with_prompt(prompt)
        .interact_text()?)
}

/// Masked password input.
pub fn password(prompt: &str) -> Result<String> {
    Ok(Password::with_theme(&theme())
        .with_prompt(prompt)
        .interact()?)
}

/// Yes/no confirmation, defaulting to no.
pub fn confirm(prompt: &str) -> Result<bool> {
    confirm_default(prompt, false)
}

/// Yes/no confirmation with an explicit default.
pub fn confirm_default(prompt: &str, default: bool) -> Result<bool> {
    Ok(Confirm::with_theme(&theme())
        .with_prompt(prompt)
        .default(default)
        .interact()?)
}

/// Block until the user presses Enter (used after printing output).
pub fn pause() {
    let _ = Input::<String>::with_theme(&theme())
        .with_prompt("press Enter to continue")
        .allow_empty(true)
        .interact_text();
}

/// Section header.
pub fn header(text: &str) {
    println!("\n{}", style(text).bold().cyan());
}

/// Print an error in red without aborting the menu loop.
pub fn error(msg: impl std::fmt::Display) {
    eprintln!("{} {}", style("error:").red().bold(), msg);
}

/// Print a success line.
pub fn success(msg: impl std::fmt::Display) {
    println!("{} {}", style("✓").green().bold(), msg);
}

/// Unwrap a `Result`, printing the error and returning `None` on failure so the
/// caller can fall through back to the menu instead of propagating.
pub fn report<T>(r: Result<T>) -> Option<T> {
    match r {
        Ok(v) => Some(v),
        Err(e) => {
            error(format!("{e:#}"));
            None
        }
    }
}
