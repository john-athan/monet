import AppKit
import SwiftUI

/// Status item, popover, pairing window and the right-click menu. Left click opens the panel
/// (or the pairing window while the Mac is not paired), right click opens the settings menu.
@MainActor
final class MenuBarApp: NSObject, NSApplicationDelegate {
    private let engine = Engine()
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var pairingWindow: NSWindow?

    func applicationDidFinishLaunching(_ note: Notification) {
        engine.start()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = StatusIcon.image()
        statusItem.button?.toolTip = "Monet"
        statusItem.button?.target = self
        statusItem.button?.action = #selector(clicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        var a = PanelActions()
        a.toggleSource = { [engine] in engine.toggleSource($0) }
        a.removeSource = { [engine] in engine.removeFolder($0) }
        a.addFolder = { [weak self] in self?.pickFolder() }
        a.copyNow = { [engine] in engine.archiveNow() }
        a.chooseArchive = { [weak self] in self?.pickArchive() }
        a.openMonet = { [engine] in engine.openMonet() }
        a.togglePause = { [engine] in engine.togglePause() }
        let host = NSHostingController(rootView: PanelHost(engine: engine, actions: a))
        host.sizingOptions = []
        popover.contentViewController = host
        popover.contentSize = NSSize(width: 360, height: 600)
        popover.behavior = .transient
        popover.animates = false

        if !engine.isPaired { showPairing() }
    }

    @objc private func clicked() {
        if NSApp.currentEvent?.type == .rightMouseUp { showMenu(); return }
        guard engine.isPaired else { showPairing(); return }
        if popover.isShown { popover.performClose(nil); return }
        engine.refreshLight()
        popover.appearance = NSAppearance(named: engine.light == .nacht ? .darkAqua : .aqua)
        if let b = statusItem.button {
            popover.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    private func showMenu() {
        let m = NSMenu()
        let host = engine.serverURL?.host ?? "kein Server"
        let head = NSMenuItem(title: engine.isPaired ? "Verbunden mit \(host)" : "Nicht verbunden", action: nil, keyEquivalent: "")
        head.isEnabled = false
        m.addItem(head)
        m.addItem(.separator())
        let login = NSMenuItem(title: "Beim Anmelden starten", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = LoginItem.isEnabled ? .on : .off
        m.addItem(login)
        if engine.isPaired {
            let un = NSMenuItem(title: "Gerät trennen …", action: #selector(unpair), keyEquivalent: "")
            un.target = self; m.addItem(un)
        } else {
            let p = NSMenuItem(title: "Mit Monet verbinden …", action: #selector(pairMenu), keyEquivalent: "")
            p.target = self; m.addItem(p)
        }
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "Monet beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = m
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func toggleLogin() {
        if let msg = LoginItem.toggle() {
            let a = NSAlert(); a.messageText = "Anmeldeobjekt nicht geändert"; a.informativeText = msg; a.runModal()
        }
    }

    @objc private func pairMenu() { showPairing() }

    @objc private func unpair() {
        let a = NSAlert()
        a.messageText = "Gerät trennen?"
        a.informativeText = "Dieser Mac lädt dann nichts mehr hoch. Bereits gesicherte Fotos bleiben in Monet."
        a.addButton(withTitle: "Trennen"); a.addButton(withTitle: "Abbrechen")
        if a.runModal() == .alertFirstButtonReturn { popover.performClose(nil); engine.unpair() }
    }

    private func showPairing() {
        if pairingWindow == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: PairingView(engine: engine) { [weak self] in
                self?.pairingWindow?.close()
            }))
            w.title = "Monet verbinden"
            w.styleMask = [.titled, .closable]
            w.isReleasedWhenClosed = false
            w.center()
            pairingWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        pairingWindow?.makeKeyAndOrderFront(nil)
    }

    private func pickFolder() {
        popover.performClose(nil)
        let p = NSOpenPanel()
        p.canChooseDirectories = true; p.canChooseFiles = false; p.allowsMultipleSelection = false
        p.prompt = "Hinzufügen"; p.message = "Welcher Ordner soll in Monet gesichert werden?"
        NSApp.activate(ignoringOtherApps: true)
        if p.runModal() == .OK, let u = p.url { engine.addFolder(u.path) }
    }

    private func pickArchive() {
        popover.performClose(nil)
        let p = NSOpenPanel()
        p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true
        p.prompt = "Wählen"; p.message = "Auf welchen Datenträger soll die zweite Kopie?"
        p.directoryURL = URL(fileURLWithPath: "/Volumes")
        NSApp.activate(ignoringOtherApps: true)
        if p.runModal() == .OK, let u = p.url { engine.chooseArchive(u.path) }
    }
}
