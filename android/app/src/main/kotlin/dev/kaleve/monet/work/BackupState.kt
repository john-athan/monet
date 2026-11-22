package dev.kaleve.monet.work

import kotlinx.coroutines.flow.MutableStateFlow

/** Process-wide progress the worker publishes and the status screen reads. */
object BackupState {
    data class Progress(val done: Int, val total: Int)
    val running = MutableStateFlow<Progress?>(null)
    /** Set when the server refused our token; the UI returns to pairing. */
    val unauthorized = MutableStateFlow(false)
}
