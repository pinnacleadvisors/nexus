import type { OAuthProvider } from './types'

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: 'google',
    name: 'Google',
    icon: 'Mail',
    description: 'Gmail, Google Calendar, Google Drive',
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.file',
    ],
    color: '#ea4335',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    envClientId: 'GOOGLE_CLIENT_ID',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'GitBranch',
    description: 'Create issues, open PRs, manage repos',
    scopes: ['repo', 'workflow'],
    color: '#e8e8f0',
    authUrl: 'https://github.com/login/oauth/authorize',
    envClientId: 'GITHUB_CLIENT_ID',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: 'MessageSquare',
    description: 'Post messages, manage channels',
    scopes: ['chat:write', 'channels:read', 'files:write'],
    color: '#4a154b',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    envClientId: 'SLACK_CLIENT_ID',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: 'FileText',
    description: 'Read and write pages, databases',
    scopes: [],
    color: '#ffffff',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    envClientId: 'NOTION_CLIENT_ID',
  },
]

export function getProvider(id: string) {
  return OAUTH_PROVIDERS.find(p => p.id === id) ?? null
}
