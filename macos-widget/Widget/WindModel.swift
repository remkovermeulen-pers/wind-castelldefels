import Foundation

/// One reading shown by the widget, merged from the /live and /zone endpoints.
struct WindSnapshot {
    var average: Double?
    var gust: Double?
    var actual: Double?
    var direction: String
    var windName: String?
    var twintip: String?   // "Yes" | "No" | "Maybe"
    var surf: String?
    var foil: String?
    var zoneStatus: String? // "OPEN" | "CLOSE" | "OPENING SOON"
    var date: Date

    /// Shown in previews and while the real fetch is in flight.
    static let placeholder = WindSnapshot(
        average: 14, gust: 18, actual: 13, direction: "E", windName: "Levante",
        twintip: "Maybe", surf: "Yes", foil: "Yes", zoneStatus: "OPEN", date: Date())

    static let unavailable = WindSnapshot(
        average: nil, gust: nil, actual: nil, direction: "?", windName: nil,
        twintip: nil, surf: nil, foil: nil, zoneStatus: nil, date: Date())
}

private struct LiveResponse: Decodable {
    let actual: Double?
    let average: Double?
    let gust: Double?
    let direction: String?
    let windName: String?
    let tempC: Double?
}

private struct ZoneResponse: Decodable {
    let status: String?
    let twintip: String?
    let surf: String?
    let foil: String?
}

/// The app's public Cloud Functions — same data the PWA uses.
enum WindAPI {
    static let base = "https://europe-west1-wind-castelldefels.cloudfunctions.net"
    static let liveURL = URL(string: "\(base)/live")!
    static let zoneURL = URL(string: "\(base)/zone")!
    static let siteURL = URL(string: "https://wind-castelldefels.web.app")!

    /// Fetches wind and zone in parallel. Never throws — missing pieces come
    /// back as nil so the widget always renders something.
    static func fetch() async -> WindSnapshot {
        async let live = get(liveURL, as: LiveResponse.self)
        async let zone = get(zoneURL, as: ZoneResponse.self)
        let (l, z) = await (live, zone)

        return WindSnapshot(
            average: l?.average, gust: l?.gust, actual: l?.actual,
            direction: l?.direction ?? "?", windName: l?.windName,
            twintip: z?.twintip, surf: z?.surf, foil: z?.foil,
            zoneStatus: z?.status, date: Date())
    }

    private static func get<T: Decodable>(_ url: URL, as: T.Type) async -> T? {
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
