import SwiftUI
import AppKit

private let siteURL = URL(string: "https://wind-castelldefels.web.app")!

struct ContentView: View {
    var body: some View {
        VStack(spacing: 14) {
            Text("🪁 Castelldefels Wind")
                .font(.title2).bold()

            Text("The widget lives in Notification Centre.\nOpen it, scroll down, click **Edit Widgets**, then add **Castelldefels Wind** (Small or Medium).")
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button("Open web app") {
                NSWorkspace.shared.open(siteURL)
            }
            .controlSize(.large)

            Text("You can quit this app once the widget is added — it keeps working.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(width: 380)
        // Tapping the widget opens the site through here.
        .onOpenURL { NSWorkspace.shared.open($0) }
    }
}
