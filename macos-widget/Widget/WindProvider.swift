import WidgetKit
import SwiftUI

struct WindEntry: TimelineEntry {
    let date: Date
    let snapshot: WindSnapshot
}

/// Feeds the widget. WidgetKit decides when to ask; it refreshes on the system
/// budget (a handful of times per hour), so we just fetch fresh data each time
/// and ask to be revisited in ~20 minutes.
struct WindProvider: TimelineProvider {
    func placeholder(in context: Context) -> WindEntry {
        WindEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (WindEntry) -> Void) {
        if context.isPreview {
            completion(WindEntry(date: Date(), snapshot: .placeholder))
            return
        }
        Task {
            let s = await WindAPI.fetch()
            completion(WindEntry(date: Date(), snapshot: s))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WindEntry>) -> Void) {
        Task {
            let s = await WindAPI.fetch()
            let entry = WindEntry(date: Date(), snapshot: s)
            let next = Calendar.current.date(byAdding: .minute, value: 20, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}
