use super::*;
use pretty_assertions::assert_eq;

fn segments(state: &str) -> Vec<(StatusLineItem, String)> {
    vec![
        (
            StatusLineItem::ModelWithReasoning,
            "gpt-6-astra medium".into(),
        ),
        (StatusLineItem::Status, state.into()),
        (StatusLineItem::ContextUsed, "Context 4% used".into()),
        (StatusLineItem::WeeklyLimit, "weekly 97% left".into()),
    ]
}

#[test]
fn native_footer_snapshot() {
    let line = render(
        segments("Ready"),
        /*colored*/ true,
        /*millis*/ 0,
        /*columns*/ 100,
    )
    .unwrap();
    insta::assert_snapshot!("leveldisplay_native_footer", line.to_string());
}

#[test]
fn quota_bars_convert_remaining_to_used() {
    let line = render(
        [
            (StatusLineItem::FiveHourLimit, "5h 25% left".into()),
            (StatusLineItem::ContextRemaining, "Context 0% left".into()),
        ],
        /*colored*/ false,
        /*millis*/ 0,
        /*columns*/ 120,
    )
    .unwrap();
    assert_eq!(line.to_string(), "5h ▰▰▰▰▰▰▰▰▱▱ 75% · ctx ▰▰▰▰▰▰▰▰▰▰ 100%");
}

#[test]
fn activity_animation_changes_colors_without_inventing_a_percentage() {
    let a = render(
        segments("Thinking"),
        /*colored*/ true,
        /*millis*/ 0,
        /*columns*/ 120,
    )
    .unwrap();
    let b = render(
        segments("Thinking"),
        /*colored*/ true,
        /*millis*/ 300,
        /*columns*/ 120,
    )
    .unwrap();
    assert_ne!(a, b);
    assert_eq!(a.to_string(), b.to_string());
    assert!(a.spans.iter().any(|s| s.style.bg.is_some()));
}

#[test]
fn idle_is_stable_and_monochrome_disables_rgb() {
    let a = render(
        segments("Ready"),
        /*colored*/ false,
        /*millis*/ 0,
        /*columns*/ 100,
    )
    .unwrap();
    let b = render(
        segments("Ready"),
        /*colored*/ false,
        /*millis*/ 900,
        /*columns*/ 100,
    )
    .unwrap();
    assert_eq!(a, b);
    assert!(
        a.spans
            .iter()
            .all(|s| s.style.fg.is_none() && s.style.bg.is_none())
    );
}

#[test]
fn missing_or_unparseable_metrics_are_preserved() {
    let line = render(
        [(StatusLineItem::WeeklyLimit, "unavailable".into())],
        /*colored*/ true,
        /*millis*/ 0,
        /*columns*/ 120,
    )
    .unwrap();
    assert_eq!(line.to_string(), "unavailable");
    assert_eq!(
        render(
            Vec::new(),
            /*colored*/ true,
            /*millis*/ 0,
            /*columns*/ 120
        ),
        None
    );
}
