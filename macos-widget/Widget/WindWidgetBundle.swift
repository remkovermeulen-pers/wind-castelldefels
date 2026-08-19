import WidgetKit
import SwiftUI

struct WindWidget: Widget {
    let kind = "WindWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WindProvider()) { entry in
            WindWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Castelldefels Wind")
        .description("Live wind and kite-zone status for Castelldefels.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct WindWidgetBundle: WidgetBundle {
    var body: some Widget {
        WindWidget()
    }
}
