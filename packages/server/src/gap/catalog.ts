/**
 * Reference catalog for gap analysis.
 * Source: Composio tool counts + workbench handoff gap analysis.
 * Update this as the reference platform expands.
 */

export interface AppTarget {
  app: string;
  totalTools: number;
  categories: string[];
  missing: string[];
}

export const composioTargets: AppTarget[] = [
  {
    app: "google",
    totalTools: 31,
    categories: ["gmail", "drive", "sheets", "calendar", "gemini"],
    missing: [
      "gmail_drafts",
      "gmail_labels",
      "gmail_threads",
      "gmail_profile",
      "gmail_advanced_search",
      "drive_upload",
      "drive_download",
      "drive_trash",
      "drive_permissions",
      "drive_search",
      "sheets_search",
      "sheets_batch_ops",
      "sheets_get_names",
      "sheets_create_spreadsheet",
      "calendar_update_event",
      "calendar_delete_event",
      "calendar_find_event",
      "calendar_get_event",
      "calendar_list_calendars",
    ],
  },
  {
    app: "atlassian-jira",
    totalTools: 10,
    categories: ["issues", "boards", "projects"],
    missing: [
      "jira_boards",
      "jira_filters",
      "jira_fields",
      "jira_permissions",
      "jira_project_types",
      "jira_user_lookup",
    ],
  },
  {
    app: "atlassian-confluence",
    totalTools: 5,
    categories: ["pages", "spaces"],
    missing: [
      "confluence_update_page",
      "confluence_get_page",
      "confluence_list_spaces",
      "confluence_delete_page",
    ],
  },
  {
    app: "atlassian-bitbucket",
    totalTools: 5,
    categories: ["repos", "pull_requests"],
    missing: [
      "bitbucket_get_pr",
      "bitbucket_list_prs",
      "bitbucket_get_repo",
    ],
  },
  {
    app: "asana",
    totalTools: 6,
    categories: ["tasks", "projects", "teams"],
    missing: [
      "asana_projects",
      "asana_teams",
      "asana_users",
      "asana_memberships",
    ],
  },
  {
    app: "github",
    totalTools: 14,
    categories: ["repos", "issues", "pull_requests", "commits", "releases"],
    missing: [
      "github_get_repo",
      "github_get_content",
      "github_list_commits",
      "github_list_branches",
      "github_commit_files",
      "github_releases",
      "github_file_crud",
    ],
  },
  {
    app: "slack",
    totalTools: 9,
    categories: ["messages", "channels", "users", "files"],
    missing: [
      "slack_search_all",
      "slack_find_channels",
      "slack_find_users",
      "slack_list_users",
    ],
  },
];

export const nextPlugins = [
  { app: "notion", categories: ["pages", "databases", "search"] },
  { app: "linear", categories: ["issues", "projects", "teams"] },
  { app: "figma", categories: ["files", "comments", "components"] },
  { app: "zoom", categories: ["meetings", "recordings", "participants"] },
  { app: "discord", categories: ["messages", "channels", "roles"] },
  { app: "aws", categories: ["s3", "ec2", "lambda"] },
];
