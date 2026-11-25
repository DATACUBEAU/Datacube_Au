package au.datacube.app.monetization

import au.datacube.app.BuildConfig

enum class DistributionAdChannel(val provider: String?) {
    DEVELOPMENT(null),
    WEBSITE("startio"),
    OPPO("admob");

    val usesDirectUpdater: Boolean get() = this == WEBSITE

    companion object {
        fun fromBuildChannel(value: String): DistributionAdChannel = when (value) {
            "website" -> WEBSITE
            "oppo" -> OPPO
            else -> DEVELOPMENT
        }

        fun current(): DistributionAdChannel = fromBuildChannel(BuildConfig.DISTRIBUTION_CHANNEL)
    }
}
