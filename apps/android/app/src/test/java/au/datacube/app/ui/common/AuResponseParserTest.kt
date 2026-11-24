package au.datacube.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuResponseParserTest {
    @Test fun rendersStructuredResponsesAndKeepsActualStatusText() {
        val blocks = AuResponseParser.parse(
            "# Results\n| Check | Status |\n| --- | --- |\n| Backup | Verified |\n" +
                "| Test | Pending |\n[ERROR] Archive is missing\n- Review the folder."
        )
        assertEquals(4, blocks.size)
        assertEquals(1, (blocks[0] as AuResponseBlock.Prose).heading)
        val table = blocks[1] as AuResponseBlock.Table
        assertEquals(listOf("Check", "Status"), table.headers)
        assertEquals(listOf("Backup", "Verified"), table.rows.first())
        assertEquals("ERROR", (blocks[2] as AuResponseBlock.Status).kind)
        assertEquals("• ", (blocks[3] as AuResponseBlock.Prose).prefix)
    }

    @Test fun malformedTablesAndUnfinishedCodeRemainReadable() {
        val plain = AuResponseParser.parse("A | B\nNot a separator")
        assertTrue(plain.all { it is AuResponseBlock.Prose })
        val code = AuResponseParser.parse("\u0060\u0060\u0060kotlin\nval x = 1")
        assertEquals("val x = 1", (code.single() as AuResponseBlock.Code).text)
    }
}
