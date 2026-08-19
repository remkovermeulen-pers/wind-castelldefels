import SwiftUI
import WidgetKit

/// Average wind at or above this many knots is highlighted (matches the app).
private let windAlertKnots = 13.0

private enum Board {
    static func color(_ v: String?) -> Color {
        switch v {
        case "Yes": return .green
        case "Maybe": return .orange
        case "No": return .red
        default: return .gray
        }
    }
    /// Spanish label, matching the mojokite board.
    static func label(_ v: String?) -> String {
        switch v {
        case "Yes": return "SI!"
        case "Maybe": return "Quizás"
        case "No": return "No"
        default: return "—"
        }
    }
}

private func kn(_ v: Double?) -> String {
    guard let v else { return "--" }
    return v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}

private func windColor(_ avg: Double?) -> Color {
    (avg ?? 0) >= windAlertKnots ? .green : .primary
}

private func zoneLine(_ status: String?) -> (String, Color) {
    switch status {
    case "OPEN": return ("Zone open", .green)
    case "OPENING SOON": return ("Opening soon", .orange)
    case .some(let s) where !s.isEmpty: return ("Zone closed", .red)
    default: return ("Zone —", .gray)
    }
}

// MARK: - Small

struct SmallWindView: View {
    let s: WindSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("CASTELLDEFELS")
                .font(.system(size: 9, weight: .semibold)).tracking(0.6)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(kn(s.average))
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .foregroundStyle(windColor(s.average))
                Text("kn").font(.system(size: 14, weight: .medium)).foregroundStyle(.secondary)
            }
            Text("gust \(kn(s.gust)) · \(s.direction)")
                .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                Circle().fill(Board.color(s.twintip)).frame(width: 9, height: 9)
                Text("Twintip \(Board.label(s.twintip))")
                    .font(.system(size: 12, weight: .semibold))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Medium

struct MediumWindView: View {
    let s: WindSnapshot

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("CASTELLDEFELS")
                    .font(.system(size: 9, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(kn(s.average))
                        .font(.system(size: 46, weight: .bold, design: .rounded))
                        .foregroundStyle(windColor(s.average))
                    Text("kn").font(.system(size: 15, weight: .medium)).foregroundStyle(.secondary)
                }
                Text("average wind").font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                HStack(spacing: 14) {
                    stat("GUST", kn(s.gust))
                    stat("DIR", s.direction)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            VStack(alignment: .leading, spacing: 7) {
                let z = zoneLine(s.zoneStatus)
                HStack(spacing: 6) {
                    Circle().fill(z.1).frame(width: 8, height: 8)
                    Text(z.0).font(.system(size: 12, weight: .semibold))
                }
                boardRow("Twintip", s.twintip)
                boardRow("Surf", s.surf)
                boardRow("Foil", s.foil)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 8, weight: .semibold)).tracking(0.5).foregroundStyle(.secondary)
            Text(value).font(.system(size: 15, weight: .semibold))
        }
    }

    private func boardRow(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(Board.label(value))
                .font(.system(size: 11, weight: .bold))
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Board.color(value).opacity(0.2), in: Capsule())
                .foregroundStyle(Board.color(value))
        }
    }
}

// MARK: - Entry view

struct WindWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: WindEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall: SmallWindView(s: entry.snapshot)
            default: MediumWindView(s: entry.snapshot)
            }
        }
        // Force dark so .primary/.secondary read light on the fixed gradient.
        .environment(\.colorScheme, .dark)
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [Color(red: 0.043, green: 0.070, blue: 0.125),
                         Color(red: 0.102, green: 0.145, blue: 0.251)],
                startPoint: .top, endPoint: .bottom)
        }
        .widgetURL(WindAPI.siteURL)
    }
}
