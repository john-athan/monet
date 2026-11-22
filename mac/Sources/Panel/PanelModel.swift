import AppKit

/// What the panel shows, as plain values. The engine builds one; tests build their own.
struct PanelModel {
    enum HeaderKind { case ok, busy, paused, offline, unpaired }
    struct Header { var kind: HeaderKind; var text: String }
    struct Thumb: Identifiable { var id: Int; var image: NSImage?; var done: Bool; var current: Bool }
    struct Card { var title: String; var thumbs: [Thumb]; var label: String?; var progress: Double? }
    struct Source: Identifiable { var id: String; var title: String; var subtitle: String; var on: Bool; var removable: Bool }
    struct Archive { var configured: Bool; var name: String; var subtitle: String; var busy: Bool }

    var header: Header
    var card: Card
    var sources: [Source]
    var archive: Archive
    var paused: Bool
}

struct PanelActions {
    var toggleSource: (String) -> Void = { _ in }
    var removeSource: (String) -> Void = { _ in }
    var addFolder: () -> Void = {}
    var copyNow: () -> Void = {}
    var chooseArchive: () -> Void = {}
    var openMonet: () -> Void = {}
    var togglePause: () -> Void = {}
}

/// The words. Kept pure so they can be tested.
enum PanelText {
    static func header(paired: Bool, pause: PausePolicy.Reason?, uploading: (done: Int, total: Int)?, offline: Bool) -> PanelModel.Header {
        if !paired { return .init(kind: .unpaired, text: "Nicht verbunden") }
        switch pause {
        case .user?: return .init(kind: .paused, text: "Pausiert")
        case .battery?: return .init(kind: .paused, text: "Pausiert, Akku niedrig")
        case .lowPower?: return .init(kind: .paused, text: "Pausiert, Energiesparmodus")
        case nil: break
        }
        if let u = uploading, u.total > u.done { return .init(kind: .busy, text: "Sichert \(u.done + 1) von \(u.total)") }
        if offline { return .init(kind: .offline, text: "Nicht alles gesichert") }
        return .init(kind: .ok, text: "Alles gesichert")
    }

    static func card(darkroom: DarkroomStatus?, uploading: (done: Int, total: Int, name: String?)?) -> (title: String, label: String?, progress: Double?) {
        if let u = uploading, u.total > u.done {
            return ("Sichert \(Phrase.photos(u.total - u.done))", u.name, Double(u.done) / Double(max(1, u.total)))
        }
        if let d = darkroom, d.busy {
            let n = d.items.isEmpty ? (d.pending ?? 1) : d.items.count
            return ("Analysiert \(Phrase.photos(max(1, n)))", d.label, d.progress)
        }
        if let d = darkroom, let p = d.pending, p > 0 {
            return ("\(Phrase.photos(p)) warten", nil, nil)
        }
        return ("Alles analysiert", nil, nil)
    }

    static func source(kind: String, total: Int, uploaded: Int, scanning: Bool) -> String {
        let unit = kind == "photos" ? "Objekte" : "Dateien"
        if scanning && total == 0 { return "wird geprüft" }
        if uploaded < total { return "\(Phrase.count(uploaded)) von \(Phrase.count(total)) gesichert" }
        return "\(Phrase.count(total)) \(unit), aktuell"
    }
}
