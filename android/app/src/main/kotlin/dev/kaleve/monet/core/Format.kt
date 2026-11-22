package dev.kaleve.monet.core

enum class Unit { Now, Minutes, Hours, Days, Never }
data class Ago(val unit: Unit, val n: Int)

/** Coarse "vor vier Minuten" arithmetic; wording lives in the string resources. */
fun ago(thenMs: Long, nowMs: Long): Ago {
    if (thenMs <= 0) return Ago(Unit.Never, 0)
    val min = ((nowMs - thenMs) / 60_000).coerceAtLeast(0)
    return when {
        min < 1 -> Ago(Unit.Now, 0)
        min < 60 -> Ago(Unit.Minutes, min.toInt())
        min < 60 * 24 -> Ago(Unit.Hours, (min / 60).toInt())
        else -> Ago(Unit.Days, (min / (60 * 24)).toInt())
    }
}
