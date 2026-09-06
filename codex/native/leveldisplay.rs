//! Opt-in native Leveldisplay footer. Uses the same metrics as the stock footer.
//!
//! The moving activity cells indicate native task state, not a percentage of
//! reasoning capacity. Context and quota cells represent percentage USED.

use std::sync::OnceLock;

use ratatui::prelude::Stylize;
use ratatui::style::Color;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::text::Span;

use super::status_line_setup::StatusLineItem;

pub(crate) fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("CODEX_LEVELDISPLAY").is_ok_and(|v| v == "1"))
}

fn percent(text: &str) -> Option<u8> {
    let before = text.split_once('%')?.0;
    before
        .split_whitespace()
        .last()?
        .parse::<u8>()
        .ok()
        .filter(|p| *p <= 100)
}

#[allow(clippy::disallowed_methods)]
fn cells(used: u8, width: usize, color: Color, colored: bool) -> Vec<Span<'static>> {
    let filled = (usize::from(used) * width + 50) / 100;
    let fill = "▰".repeat(filled);
    let empty = "▱".repeat(width - filled);
    if colored {
        vec![fill.fg(color), empty.fg(Color::Rgb(90, 90, 95))]
    } else {
        vec![fill.into(), empty.into()]
    }
}

#[allow(clippy::disallowed_methods)]
fn activity(state: &str, width: usize, millis: u128, colored: bool) -> Vec<Span<'static>> {
    let millis = millis / 300 * 300;
    let active = matches!(state, "Working" | "Thinking" | "Starting");
    let mut spans = Vec::new();
    for x in 0..width {
        let glyph = if active { "▰" } else { "▱" };
        let style = if !colored {
            Style::default()
        } else if !active {
            Style::default().fg(Color::Rgb(90, 90, 95))
        } else if state == "Thinking" {
            let distance = (x as f64 - (width - 1) as f64 / 2.0).abs();
            let q = (distance - millis as f64 / 120.0).rem_euclid(20.0);
            let level =
                (7.0 * (1.0 + (std::f64::consts::TAU * q / 20.0).cos()) / 2.0).round() / 7.0;
            let blend = |a: f64, b: f64| (a + (b - a) * level).round() as u8;
            Style::default()
                .fg(Color::Rgb(208, 180, 255))
                .bg(Color::Rgb(
                    blend(62.0, 140.0),
                    blend(22.0, 80.0),
                    blend(118.0, 240.0),
                ))
        } else {
            let stops = [
                [175.0, 82.0, 222.0],
                [255.0, 55.0, 95.0],
                [255.0, 159.0, 10.0],
            ];
            let phase = ((x as f64 / width as f64 + millis as f64 / 400.0) % 1.0) * 2.0;
            let i = phase.floor() as usize;
            let blend = |k: usize| {
                (stops[i][k] + (stops[i + 1][k] - stops[i][k]) * (phase - i as f64)).round() as u8
            };
            Style::default().fg(Color::Rgb(blend(0), blend(1), blend(2)))
        };
        spans.push(Span::styled(glyph, style));
    }
    let word = match state {
        "Ready" => "snoozing",
        "Thinking" => "ultracoding",
        "Working" => "cooking",
        "Starting" => "starting",
        "Waiting" => "waiting",
        other => other,
    };
    spans.push(format!(" {word}").into());
    spans
}

#[allow(clippy::disallowed_methods)]
pub(crate) fn render<I>(
    segments: I,
    colored: bool,
    millis: u128,
    columns: u16,
) -> Option<Line<'static>>
where
    I: IntoIterator<Item = (StatusLineItem, String)>,
{
    let mut spans = Vec::new();
    let meter_width = if columns < 110 { 6 } else { 10 };
    let activity_width = if columns < 110 { 8 } else { 24 };
    for (item, text) in segments {
        if !spans.is_empty() {
            spans.push(" · ".dim());
        }
        if item == StatusLineItem::Status {
            spans.extend(activity(&text, activity_width, millis, colored));
            continue;
        }
        let metric = match item {
            StatusLineItem::ContextUsed => percent(&text).map(|p| ("ctx", p, true)),
            StatusLineItem::ContextRemaining => percent(&text).map(|p| ("ctx", 100 - p, true)),
            StatusLineItem::FiveHourLimit | StatusLineItem::WeeklyLimit => {
                percent(&text).map(|p| {
                    let label = text.split_whitespace().next().unwrap_or("usage");
                    let label = if label == "weekly" { "7d" } else { label };
                    (label, 100 - p, false)
                })
            }
            _ => None,
        };
        if let Some((label, used, context)) = metric {
            let color = if used >= 90 {
                Color::Rgb(255, 69, 58)
            } else if used >= 75 {
                Color::Rgb(245, 166, 35)
            } else if context {
                Color::Rgb(120, 200, 130)
            } else {
                Color::Rgb(110, 159, 212)
            };
            spans.push(format!("{label} ").into());
            spans.extend(cells(used, meter_width, color, colored));
            spans.push(format!(" {used}%").into());
        } else {
            spans.push(text.into());
        }
    }
    (!spans.is_empty()).then(|| Line::from(spans))
}

#[cfg(test)]
#[path = "leveldisplay_tests.rs"]
mod tests;
