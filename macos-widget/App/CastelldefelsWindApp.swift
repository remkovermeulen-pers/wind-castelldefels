import SwiftUI

/// A minimal host app. Its only jobs are to exist so macOS registers the
/// widget, and to open the full web app when asked.
@main
struct CastelldefelsWindApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowResizability(.contentSize)
    }
}
