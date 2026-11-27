package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Native step navigation, with full text accessible without paging. */
@Composable
internal fun AuStepDeck(block:AuResponseBlock.Steps) {
    var page by rememberSaveable(block.title,block.pages.hashCode()) { mutableIntStateOf(0) }
    var expanded by rememberSaveable(block.title,block.pages.hashCode()) { mutableStateOf(false) }
    val index=page.coerceIn(0,block.pages.lastIndex)
    Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant),
        color=MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(block.title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
            if(expanded) {
                block.pages.forEachIndexed { i,item ->
                    if(i>0) HorizontalDivider()
                    Text("${i+1}. ${item.title}",style=MaterialTheme.typography.titleSmall,fontWeight=FontWeight.SemiBold)
                    AuRichResponse(item.body)
                }
            } else {
                AuStepProgress(index,block.pages.size)
                Text(block.pages[index].title,style=MaterialTheme.typography.titleMedium)
                AuRichResponse(block.pages[index].body)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick={page=index-1},enabled=index>0,modifier=Modifier.weight(1f),
                        contentPadding=PaddingValues(horizontal=8.dp)) { Text("Previous") }
                    Button(onClick={page=if(index==block.pages.lastIndex) 0 else index+1},
                        modifier=Modifier.weight(1f),contentPadding=PaddingValues(horizontal=8.dp)) {
                        Text(if(index==block.pages.lastIndex) "Start over" else "Next")
                    }
                }
            }
            TextButton(onClick={expanded=!expanded}) { Text(if(expanded) "Show one step" else "Show all steps") }
        }
    }
}
