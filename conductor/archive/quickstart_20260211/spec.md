# Specification: 0. Quickstart Menu Option

## Overview
This track aims to add a new menu option titled "0. Quickstart" to the SSI Toolkit's Google Apps Script menu. This option will provide users with quick access to an introductory Google Docs document.

## Functional Requirements
- A new menu item, "0. Quickstart", shall be added to the main SSI Toolkit menu.
- The "0. Quickstart" menu item shall be the *first* option in the SSI Toolkit menu.
- When the "0. Quickstart" menu item is clicked, it shall open the Google Docs document located at `https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?usp=sharing` in a new browser tab.

## Non-Functional Requirements
- None.

## Acceptance Criteria
- The "0. Quickstart" menu item is visible within the SSI Toolkit menu when the Google Sheet is opened.
- The "0. Quickstart" menu item appears as the very first option in the SSI Toolkit menu.
- Clicking the "0. Quickstart" menu item successfully opens the specified Google Docs URL in a new browser tab.

## Out of Scope
- Displaying the content of the Google Docs document directly within a Google Sheets sidebar or modal dialog.
