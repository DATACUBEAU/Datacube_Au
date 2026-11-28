package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuVisualDataTest {
    @Test fun timelinePreservesActualEventOrderAndRejectsMalformedRows() {
        val rows=listOf("Phase 1 | Define the problem","Phase 2 | Evaluate evidence","Phase 3 | Present findings")
        val data=AuVisualData.timeline("Research process",rows)!!
        assertEquals(listOf("Phase 1","Phase 2","Phase 3"),data.events.map { it.time })
        assertNull(AuVisualData.timeline("Bad",rows+"Unknown"))
        assertNull(AuVisualData.timeline("Bad",rows+rows.first()))
        assertEquals(AuVisualPlan.Kind.TIMELINE,AuVisualPlan.kind("Create a historical timeline"))
        assertTrue(AuTeachingPolicy.plan("Create a historical timeline").visual==AuTeachingPolicy.Visual.REQUESTED)
    }

    @Test fun mapsSupportSharedTargetsAndCyclesWithoutInventedEdges() {
        val rows=listOf("NODE | a | Client","NODE | b | Service","NODE | c | Database",
            "EDGE | a | b | requests","EDGE | b | c | reads","EDGE | c | b | returns")
        val map=AuVisualData.map("Data architecture",rows)!!
        assertEquals(3,map.nodes.size)
        assertEquals(listOf("requests","reads","returns"),map.edges.map { it.label })
        assertNull(AuVisualData.map("Bad",rows+"EDGE | a | unknown | writes"))
        assertNull(AuVisualData.map("Bad",rows+"EDGE | a | a | self"))
        assertNull(AuVisualData.map("Bad",rows+"NODE | d | Unconnected"))
    }
    @Test fun plotsSupportSignedValuesAndRejectNonfiniteOrMisorderedLineData() {
        val rows=listOf("AXES | Time (s) | Position (m)","-2 | -3","0 | 1","3 | -1")
        val plot=AuVisualData.plot("Position",rows,false)!!
        assertEquals(-3.0,plot.series.first().y,0.0)
        assertNull(AuVisualData.plot("Bad",rows+"2 | 4",false))
        assertNull(AuVisualData.plot("Bad",rows+"4 | NaN",false))
        assertNotNull(AuVisualData.plot("Scatter",rows+"2 | 4",true))
        assertNull(AuVisualData.plot("Bad",rows+"4 | Infinity",true))
    }
    @Test fun modelsUseDeterministicMathAndBoundedInputs() {
        val q=AuQuadratic(2.0,-3.0,1.0)
        assertEquals(3.0,q.y(2.0),1e-10)
        assertEquals(81,q.plot().series.size)
        val p=AuPendulum(1.0,9.81)
        assertEquals(2.00606668,p.period,1e-6)
        assertEquals(.15,p.angle(0.0),1e-10)
        assertEquals(-.15,p.angle(p.period/2),1e-10)
        assertEquals(2*p.period,AuPendulum(1.0,9.81/4).period,1e-10)
        assertTrue(runCatching { AuQuadratic(Double.NaN) }.isFailure)
        assertTrue(runCatching { AuPendulum(-1.0) }.isFailure)
    }
    @Test fun routingRespectsSubjectAndTextOnlyAndExactInputs() {
        assertEquals(AuVisualPlan.Kind.MAP,AuVisualPlan.kind("Create a data mapping diagram"))
        assertEquals(AuVisualPlan.Kind.PLOT,AuVisualPlan.kind("Show a line chart"))
        assertEquals(AuVisualPlan.Kind.SCATTER,AuVisualPlan.kind("Show a scatter plot"))
        assertEquals(AuSimulationKind.QUADRATIC,AuSimulationKind.select("Explain quadratic functions"))
        assertEquals(AuSimulationKind.PENDULUM,AuSimulationKind.select("Simulate a simple pendulum"))
        assertNull(AuSimulationKind.select("Explain quadratic functions with no diagrams"))
        assertNull(AuSimulationKind.select("Plot y = 2x² + 3"))
        assertTrue(AuVisualPlan.instruction("Draw a knowledge graph").contains("[MAP]"))
        assertTrue(AuVisualPlan.instruction("Simulate a simple pendulum").contains("[SIM] pendulum"))
    }
}
