package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyContentQualityTest {
    @Test fun removesCopyrightTailWithoutLosingIntroductoryTopic() {
        val line = "An introductory guide to building cross-platform mobile applications with Flutter and Dart 2 Copyright © 2019 Packt Publishing"
        val clean = StudyContentQuality.cleanExcerpt(line)
        assertTrue(clean.contains("cross-platform mobile applications"))
        assertFalse(clean.contains("Copyright"))
        assertFalse(clean.contains("Packt"))
    }

    @Test fun overviewPrefersActualLearningContentToTitleAndPublisherFragments() {
        val excerpts = listOf(
            RagEvidence("Flutter for Beginners", 1),
            RagEvidence("Copyright © 2019 Packt Publishing. No part of this publication may be reproduced.", 1),
            RagEvidence("This book introduces the Flutter framework and explains how to create cross-platform applications with Dart.", 2),
            RagEvidence("This chapter describes application architecture and demonstrates using widgets to build a mobile interface.", 7)
        )
        val summary = StudyContentQuality.extractiveSummary(excerpts)
        assertTrue(summary.contains("Flutter framework"))
        assertTrue(summary.contains("application architecture"))
        assertFalse(summary.contains("Copyright"))
    }

    @Test fun overviewDoesNotFabricateMaterialWhenOnlyFrontMatterExists() {
        val excerpts = listOf(RagEvidence("Copyright © 2019", 1))
        val summary = StudyContentQuality.extractiveSummary(excerpts)
        assertTrue(summary.contains("no clear study passage"))
    }

    @Test fun rejectsGenericHeadingsButKeepsActualStudyTopic() {
        assertFalse(StudyContentQuality.usefulHeading("Chapter"))
        assertFalse(StudyContentQuality.usefulHeading("Copyright © 2019"))
        assertTrue(StudyContentQuality.usefulHeading("Building cross-platform mobile applications"))
    }
}
