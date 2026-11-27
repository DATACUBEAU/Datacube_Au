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

    @Test fun typedTimeAndChatIntentShareConservativeParsing() {
        assertEquals(now.plusHours(5).toInstant().toEpochMilli(), AuScheduleIntent.parseTime("next five hours", now))
        assertEquals(now.plusHours(1).toInstant().toEpochMilli(), AuScheduleIntent.parseTime("next hour", now))
        assertEquals(now.plusHours(1).toInstant().toEpochMilli(), AuScheduleIntent.parseTime("one hour", now))
        assertEquals(now.plusHours(5).toInstant().toEpochMilli(), AuScheduleIntent.proposedTime("Remind me to revise in five hours", now))
        assertEquals(now.withHour(18).withMinute(30).toInstant().toEpochMilli(), AuScheduleIntent.parseTime("18:30", now))
        assertEquals(now.plusDays(9).withHour(9).toInstant().toEpochMilli(), AuScheduleIntent.parseTime("2026-12-03 09:00", now))
        assertNull(AuScheduleIntent.parseTime("2026-02-30 09:00", now))
        assertNull(AuScheduleIntent.parseTime("tomorrow", now))
        assertNull(AuScheduleIntent.parseTime("tomorrow at 7", now))
        assertNull(AuScheduleIntent.parseTime("in 0 hours", now))
        assertNull(AuScheduleIntent.parseTime("in one hour or tomorrow at 9 AM", now))
        assertNull(AuScheduleIntent.proposedTime("Remind me to study for two hours", now))
    }
}
