package dev.kaleve.monet.core

enum class Light { Morgen, Mittag, Abend, Nacht }

/** morgen 6-10, mittag 10-17, abend 17-21, nacht 21-6. System dark forces nacht. */
fun lightFor(hour: Int, systemDark: Boolean): Light = when {
    systemDark -> Light.Nacht
    hour in 6..9 -> Light.Morgen
    hour in 10..16 -> Light.Mittag
    hour in 17..20 -> Light.Abend
    else -> Light.Nacht
}
