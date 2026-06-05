#!/bin/bash

# List of all private IIFE state variables
declare -a vars=(
  "_currentView" "_currentUser" "_currentMarketingTab" "_currentMarketingListTab"
  "_selectedEntity" "_selectedAttendees" "_selectedCoAgents" "_selectedConsultants"
  "_selectedReferrer" "_selectedProspectReferrer" "_pendingIntakeId" "_pendingIntakeRow"
  "_currentDate" "_filters" "_lastNavigatedAt" "_purchasesHistoryCache"
  "_purchasesHistoryCacheTs" "_phFilter" "_phPage" "_venuesCache" "_venuesCacheTs"
  "_productsCache" "_productsCacheTs" "_renderCalendarToken" "_currentDetailView"
  "_agentsLeadersCache" "_agentsLeadersCacheTs" "_searchPanelVisible"
  "_currentSearchEntity" "_currentSearchFilters" "_conditionGroups" "_savedSearches"
  "_searchHistory" "_currentSearchResults" "_currentPage" "_pageSize" "_totalResults"
  "_currentSelectedPerson" "_treeZoom" "_treeSvg" "_currentTreeData" "_treeNavStack"
  "_treeActiveFilter" "_leaderboardPeriod" "_currentFolder" "_viewMode" "_selectedFiles"
  "_fileSortBy" "_fileSortDirection" "_fileFilter" "_draggedFileId" "_clipboardFiles"
  "_clipboardAction" "_mediaRecorder" "_audioChunks" "_recordingStartTime"
  "_recordingTimer" "_recordingStream" "_offlineQueue" "_isOnline" "_initStarted"
  "_predictivePrefetchRan" "_sortField" "_sortDirection" "_prospectPage"
  "_prospectViewMode" "_customerPage" "_lastReset"
)

for file in script-*.js; do
  [[ "$file" == *.min.js ]] && continue
  
  for var in "${vars[@]}"; do
    # Check if variable is referenced (not as part of declaration or _state.)
    refs=$(grep -n "$var" "$file" 2>/dev/null | grep -v "let $var\|const $var\|var $var\|_state\.$var" | head -5)
    
    if [ -n "$refs" ]; then
      # Check if variable is locally declared
      if ! grep -q "^\s*\(let\|const\|var\)\s*$var" "$file"; then
        echo "$file → $var"
        echo "$refs" | cut -d: -f1 | while read line; do
          echo "  line $line"
        done
      fi
    fi
  done
done
