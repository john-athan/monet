package dev.kaleve.monet.core

import org.junit.Assert.assertEquals
import org.junit.Test

class LightTest {
    @Test fun boundaries() {
        val expect = mapOf(0 to Light.Nacht, 5 to Light.Nacht, 6 to Light.Morgen, 9 to Light.Morgen, 10 to Light.Mittag,
            16 to Light.Mittag, 17 to Light.Abend, 20 to Light.Abend, 21 to Light.Nacht, 23 to Light.Nacht)
        expect.forEach { (h, l) -> assertEquals("hour $h", l, lightFor(h, false)) }
    }
    @Test fun systemDarkForcesNacht() { for (h in 0..23) assertEquals(Light.Nacht, lightFor(h, true)) }
}
