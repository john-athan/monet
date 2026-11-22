import AppKit
import SwiftUI

final class PauseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var v: PausePolicy.Reason?
    var value: PausePolicy.Reason? { get { lock.lock(); defer { lock.unlock() }; return v } set { lock.lock(); v = newValue; lock.unlock() } }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var v = false
    func set() { lock.lock(); v = true; lock.unlock() }
    func take() -> Bool { lock.lock(); defer { lock.unlock() }; let r = v; v = false; return r }
}

/// Everything the app does, in one place the panel can observe.
@MainActor
final class Engine: ObservableObject {
    @Published private(set) var model: PanelModel
    @Published private(set) var light: Light = .mittag
    @Published private(set) var style: Style
    @Published var pairingError: String?

    private(set) var config: Config
    private let configURL: URL
    private let tokens: TokenStore
    private var store: StateStore?
    private var api: Api?
    private var pipeline: Pipeline?
    private var watcher: FolderWatcher?
    private let photos = PhotosSource()
    private let indexer = Indexer()
    private let pauseBox = PauseBox()
    private let ocrKick = Flag()
    private var ocrTask: Task<Void, Never>?
    private var syncRunner: Task<Void, Never>?
    private var syncDirty = false
    private var tick: Timer?
    private var nextStatusAt = Date.distantPast

    // live state
    private var darkroom: DarkroomStatus?
    private var thumbs: [Int: NSImage] = [:]
    private var thumbLoading = Set<Int>()
    private var upQueued = 0, upDone = 0
    private var upName: String?
    private var syncFailed = false
    private var scanning = Set<String>()
    private var photosDenied = false
    private var photosCount = 0
    private var archiveBusy = false
    private var archiveCount = 0
    private var nextArchiveAt = Date.distantFuture

    /// Cached: the Keychain is read once at start, on pairing and on unpairing, not on every redraw.
    private(set) var isPaired = false
    var serverURL: URL? { ServerURL.normalize(config.serverURL) }

    init(tokens: TokenStore = KeychainTokenStore()) {
        self.tokens = tokens
        configURL = Paths.home.appendingPathComponent("config.json")
        config = Config.load(from: configURL)
        style = Styles.of(config.theme)
        model = PanelModel(header: .init(kind: .unpaired, text: "Nicht verbunden"),
                           card: .init(title: "Alles analysiert", thumbs: [], label: nil, progress: nil),
                           sources: [], archive: .init(configured: false, name: "", subtitle: "", busy: false), paused: false)
        indexer.onStatus = { [weak self] s in self?.darkroomChanged(s) }
        photos.onChange = { [weak self] in Task { @MainActor in self?.requestSync() } }
    }

    // MARK: Lifecycle

    func start() {
        refreshLight()
        isPaired = tokens.load() != nil && config.deviceId != nil
        if isPaired { startServices() }
        tick = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.heartbeat() }
        }
        rebuild()
    }

    func refreshLight() {
        let dark = NSApp?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let l = LightClock.light(hour: Calendar.current.component(.hour, from: Date()), darkAppearance: dark)
        if l != light { light = l }
    }

    private func save() { config.save(to: configURL) }

    private func startServices() {
        guard let token = tokens.load(), let base = serverURL,
              let st = try? StateStore(path: Paths.home.appendingPathComponent("state.sqlite").path) else { return }
        store = st
        let a = Api(base: base, token: token)
        api = a
        updatePause()
        let gate = RunGate { [pauseBox] in pauseBox.value }
        pipeline = Pipeline(api: a, store: st, gate: gate) { [weak self] e in Task { @MainActor in self?.handle(e) } }
        rewatch()
        if config.photosEnabled && PhotosSource.allowed { photos.startObserving(); photosCount = PhotosSource.assetCount() }
        startOcrLoop(api: a, store: st, gate: gate)
        indexer.start(api: a)
        scheduleArchive()
        nextStatusAt = .distantPast
        refreshStyle()
        requestSync()
        rebuild()
    }

    private func stopServices() {
        ocrTask?.cancel(); ocrTask = nil
        syncRunner?.cancel(); syncRunner = nil
        watcher?.stop(); watcher = nil
        photos.stopObserving()
        indexer.stop()
        pipeline = nil; api = nil
    }

    private func heartbeat() {
        refreshLight()
        guard isPaired else { return }
        refreshStyle()
        let before = pauseBox.value
        updatePause()
        if before != nil && pauseBox.value == nil { requestSync(); ocrKick.set() }
        if Date() >= nextArchiveAt && !archiveBusy, let root = config.archivePath, ArchiveCopier.isAvailable(root: URL(fileURLWithPath: root)) {
            archiveNow()
        }
        rebuild()
    }

    /// Asks the server for the owner's style at start and then at most every five minutes. A failure keeps the
    /// persisted style and is retried on the next interval.
    private func refreshStyle() {
        guard let a = api, Date() >= nextStatusAt else { return }
        nextStatusAt = Date().addingTimeInterval(300)
        Task { [weak self] in
            guard let o = try? await a.status() else { return }
            await MainActor.run {
                guard let self, let t = o["theme"] as? String else { return }
                if t != self.config.theme { self.config.theme = t; self.save() }
                let s = Styles.of(t)
                if s != self.style { self.style = s }
            }
        }
    }

    private func updatePause() { pauseBox.value = Power.currentReason(userPaused: config.paused) }

    // MARK: Pairing

    func pair(server: String, code: String) async -> Bool {
        guard let url = ServerURL.normalize(server) else { pairingError = "Die Adresse ist ungültig."; return false }
        guard let c = PairingCode.normalize(code) else { pairingError = "Der Code hat 8 Zeichen."; return false }
        let name = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        do {
            let r = try await Api(base: url, token: nil).claim(code: c, name: name)
            guard tokens.save(r.token) else { pairingError = "Der Schlüsselbund hat den Token nicht angenommen."; return false }
            stopServices()
            config.serverURL = url.absoluteString
            config.deviceId = r.deviceId.isEmpty ? "mac" : r.deviceId
            save()
            pairingError = nil
            isPaired = true
            startServices()
            return true
        } catch let e as ApiError {
            pairingError = e.status == 429 ? "Zu viele Versuche. Bitte warte kurz." : "Der Code passt nicht oder ist abgelaufen."
            return false
        } catch {
            pairingError = "Der Server ist nicht erreichbar."
            return false
        }
    }

    func unpair() {
        stopServices()
        store?.reset(); store = nil
        tokens.delete()
        isPaired = false
        config.deviceId = nil
        save()
        thumbs = [:]; darkroom = nil
        rebuild()
    }

    // MARK: Sources

    func toggleSource(_ id: String) {
        if id == "photos" { Task { await setPhotos(!config.photosEnabled) }; return }
        guard let i = config.folders.firstIndex(where: { $0.path == id }) else { return }
        config.folders[i].enabled.toggle(); save(); rewatch(); requestSync(); rebuild()
    }

    func addFolder(_ path: String) {
        guard !config.folders.contains(where: { $0.path == path }) else { return }
        config.folders.append(FolderSource(path: path)); save(); rewatch(); requestSync(); rebuild()
    }

    func removeFolder(_ path: String) {
        config.folders.removeAll { $0.path == path }
        store?.remove(source: Pipeline.source(forFolder: path))
        save(); rewatch(); rebuild()
    }

    /// The permission dialog appears here and nowhere else.
    func setPhotos(_ on: Bool) async {
        if !on {
            config.photosEnabled = false; save(); photos.stopObserving(); photosDenied = false; rebuild(); return
        }
        let ok = PhotosSource.allowed ? true : await PhotosSource.requestAccess()
        photosDenied = !ok
        config.photosEnabled = ok; save()
        if ok { photos.startObserving(); photosCount = PhotosSource.assetCount(); requestSync() }
        rebuild()
    }

    private func rewatch() {
        watcher?.stop(); watcher = nil
        let paths = config.folders.filter(\.enabled).map(\.path)
        guard !paths.isEmpty else { return }
        watcher = FolderWatcher(paths: paths) { [weak self] _ in Task { @MainActor in self?.requestSync() } }
    }

    // MARK: Sync

    func requestSync() {
        guard pipeline != nil else { return }
        syncDirty = true
        guard syncRunner == nil else { return }
        syncRunner = Task { [weak self] in
            while let self, self.syncDirty, !Task.isCancelled {
                self.syncDirty = false
                await self.runAll()
            }
            self?.syncRunner = nil
        }
    }

    private func runAll() async {
        guard let p = pipeline else { return }
        var failed = 0
        for f in config.folders where f.enabled {
            let r = await p.syncFolder(f.path)
            failed += r.failed
            rebuild()
        }
        if config.photosEnabled && PhotosSource.allowed {
            let r = await photos.sync(pipeline: p)
            failed += r.failed
            photosCount = PhotosSource.assetCount()
        }
        syncFailed = failed > 0
        ocrKick.set()
        rebuild()
    }

    private func handle(_ e: SyncEvent) {
        switch e {
        case .hashing(let n): upName = n
        case .upload(let u):
            switch u {
            case .queued(let n):
                if upDone >= upQueued { upQueued = 0; upDone = 0 }
                upQueued += n
            case .started(let n): upName = n
            case .finished: upDone += 1; if upDone >= upQueued { upName = nil; ocrKick.set() }
            }
        case .scanned(let s): scanning.remove(s)
        }
        rebuild()
    }

    // MARK: OCR

    private func startOcrLoop(api: Api, store: StateStore, gate: RunGate) {
        ocrTask?.cancel()
        let worker = OcrWorker(api: api, store: store, gate: gate)
        let kick = ocrKick
        ocrTask = Task.detached(priority: .utility) {
            while !Task.isCancelled {
                if await worker.runOnce() > 0 { continue }
                for _ in 0..<60 {
                    if Task.isCancelled || kick.take() { break }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
            }
        }
    }

    // MARK: Indexer status and thumbnails

    private func darkroomChanged(_ s: DarkroomStatus?) {
        guard s != darkroom else { return }
        darkroom = s
        for it in s?.items ?? [] where thumbs[it.id] == nil && !thumbLoading.contains(it.id) {
            guard let a = api else { break }
            thumbLoading.insert(it.id)
            Task { [weak self] in
                let d = try? await a.thumbnail(id: it.id)
                await MainActor.run {
                    guard let self else { return }
                    self.thumbLoading.remove(it.id)
                    if let d, let img = NSImage(data: d) { self.thumbs[it.id] = img; self.rebuild() }
                }
            }
        }
        if thumbs.count > 60 { thumbs = thumbs.filter { id, _ in s?.items.contains { $0.id == id } == true } }
        rebuild()
    }

    // MARK: Archive

    private func scheduleArchive() {
        nextArchiveAt = config.archivePath == nil ? .distantFuture : NightlySchedule.next(after: Date())
    }

    func chooseArchive(_ path: String?) {
        config.archivePath = path; config.archiveLast = nil; save(); scheduleArchive(); rebuild()
    }

    func archiveNow() {
        guard !archiveBusy, let a = api, let st = store, let root = config.archivePath else { return }
        archiveBusy = true; archiveCount = 0; rebuild()
        let gate = RunGate { [pauseBox] in pauseBox.value }
        Task { [weak self] in
            let url = URL(fileURLWithPath: root)
            let r = try? await ArchiveCopier.run(api: a, store: st, root: url, gate: gate) { n in
                Task { @MainActor in self?.archiveCount = n; self?.rebuild() }
            }
            guard let self else { return }
            self.archiveBusy = false
            if let r, r.failed == 0 { self.config.archiveLast = Date(); self.save(); self.scheduleArchive() }
            else { self.nextArchiveAt = Date().addingTimeInterval(600) }
            self.rebuild()
        }
    }

    // MARK: Pause, open

    func togglePause() { config.paused.toggle(); save(); updatePause(); if !config.paused { requestSync(); ocrKick.set() }; rebuild() }

    func openMonet() { if let u = serverURL { NSWorkspace.shared.open(u) } }

    // MARK: Model

    private func rebuild() {
        let paired = isPaired
        let up: (Int, Int)? = upQueued > 0 ? (upDone, upQueued) : nil
        let header = PanelText.header(paired: paired, pause: pauseBox.value, uploading: up, offline: syncFailed)
        let card = PanelText.card(darkroom: darkroom, uploading: up.map { ($0.0, $0.1, upName) })
        var thumbRow: [PanelModel.Thumb] = []
        if darkroom?.busy == true, let items = darkroom?.items {
            let firstOpen = items.firstIndex { !$0.done }
            thumbRow = items.prefix(3).enumerated().map { i, it in
                .init(id: it.id, image: thumbs[it.id], done: it.done, current: i == firstOpen)
            }
        }
        var rows: [PanelModel.Source] = []
        if let st = store {
            let pc = st.counts(source: PhotosSource.source)
            var sub = PanelText.source(kind: "photos", total: max(photosCount, pc.total), uploaded: pc.uploaded, scanning: false)
            if !config.photosEnabled { sub = photosDenied ? "Kein Zugriff, in den Systemeinstellungen erlauben" : "Aus" }
            rows.append(.init(id: "photos", title: "Fotos-Mediathek", subtitle: sub, on: config.photosEnabled, removable: false))
            for f in config.folders {
                let c = st.counts(source: Pipeline.source(forFolder: f.path))
                let sub = f.enabled ? PanelText.source(kind: "folder", total: c.total, uploaded: c.uploaded, scanning: syncRunner != nil) : "Aus"
                rows.append(.init(id: f.path, title: f.name, subtitle: sub, on: f.enabled, removable: true))
            }
        } else {
            rows.append(.init(id: "photos", title: "Fotos-Mediathek", subtitle: "Aus", on: false, removable: false))
        }
        var arch = PanelModel.Archive(configured: false, name: "", subtitle: "Noch kein Ordner gewählt", busy: archiveBusy)
        if let p = config.archivePath {
            let root = URL(fileURLWithPath: p)
            arch.configured = true
            arch.name = ArchiveCopier.displayName(root: root)
            if archiveBusy { arch.subtitle = archiveCount > 0 ? "kopiert \(Phrase.count(archiveCount)) Dateien" : "wird geprüft" }
            else if !ArchiveCopier.isAvailable(root: root) { arch.subtitle = "Datenträger nicht angeschlossen" }
            else if let d = config.archiveLast { arch.subtitle = "zuletzt \(Phrase.lastCopy(d))" }
            else { arch.subtitle = "noch nicht kopiert" }
        }
        model = PanelModel(header: header, card: .init(title: card.title, thumbs: thumbRow, label: card.label, progress: card.progress),
                           sources: rows, archive: arch, paused: config.paused)
    }
}
