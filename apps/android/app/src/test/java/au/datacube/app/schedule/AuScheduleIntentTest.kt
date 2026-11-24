package au.datacube.app.schedule

import org.junit.Assert.*
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class AuScheduleIntentTest {
    private val now = ZonedDateTime.of(2026, 11, 24, 14, 0, 0, 0, ZoneId.of("Africa/Lagos"))

    @Test fun recognisesExplicitRequestsOnly() {
        assertTrue(AuScheduleIntent.matches("AU, remind me to revise chemistry tomorrow at 7 PM"))
        assertTrue(AuScheduleIntent.matches("Can you schedule a study session"))
        assertFalse(AuScheduleIntent.matches("Explain how to schedule a task"))
        assertFalse(AuScheduleIntent.matches("What does a reminder mean?"))
    }

    @Test fun prefillRelativeAndExplicitDayTimes() {
        assertEquals(now.plusMinutes(30).toInstant().toEpochMilli(),
            AuScheduleIntent.proposedTime("Remind me to revise in 30 minutes", now))
        assertEquals(now.plusDays(1).withHour(19).toInstant().toEpochMilli(),
            AuScheduleIntent.proposedTime("Remind me tomorrow at 7 PM", now))
        assertEquals(now.plusDays(1).withHour(0).toInstant().toEpochMilli(),
            AuScheduleIntent.proposedTime("Remind me tomorrow at 12 AM", now))
    }

    @Test fun ambiguousAndPastTimesRequireManualSelection() {
        assertNull(AuScheduleIntent.proposedTime("Remind me tomorrow", now))
        assertNull(AuScheduleIntent.proposedTime("Remind me today at 1 PM", now))
        assertNull(AuScheduleIntent.proposedTime("Remind me tomorrow at 13 PM", now))
        assertNull(AuScheduleIntent.proposedTime("Remind me in 0 minutes", now))
        assertNull(AuScheduleIntent.proposedTime("Remind me tomorrow at 7 PM or in 30 minutes", now))
    }
}
