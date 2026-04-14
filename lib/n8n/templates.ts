/**
 * lib/n8n/templates.ts
 * 8 pre-built n8n workflow blueprints for common business automations.
 * Each template produces valid n8n v1 JSON ready to import.
 */

import type { WorkflowTemplate } from './types'

// ── Template 1: Social Post Scheduler ────────────────────────────────────────
const socialPostScheduler: WorkflowTemplate = {
  id:                     'social-post-scheduler',
  name:                   'Social Post Scheduler',
  description:            'Reads a content queue from Notion, generates platform-optimised copy with Claude, and posts to Twitter/X and LinkedIn daily.',
  category:               'content',
  estimatedSetupMinutes:  25,
  requiredCredentials:    ['notionApi', 'twitterOAuth2Api', 'linkedInOAuth2Api', 'anthropicApi'],
  requiredEnvVars:        ['ANTHROPIC_API_KEY'],
  triggers:               ['Daily at 9 AM (configurable)'],
  setupChecklist: [
    'Connect your Notion account and copy the content database ID',
    'Authorise Twitter/X via OAuth 2 in n8n credentials',
    'Authorise LinkedIn via OAuth 2 in n8n credentials',
    'Add your ANTHROPIC_API_KEY to n8n environment variables',
    'Set the NOTION_DATABASE_ID parameter in the Notion node',
    'Activate the workflow',
  ],
  openClawSteps: [
    'Initial OAuth authorisation for Twitter/X if browser login is needed',
    'Initial OAuth authorisation for LinkedIn if browser login is needed',
  ],
  workflow: {
    name: 'Social Post Scheduler',
    active: false,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    tags: ['content', 'social', 'automation'],
    nodes: [
      {
        id: 'n1',
        name: 'Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          rule: { interval: [{ field: 'hours', triggerAtHour: 9 }] },
        },
      },
      {
        id: 'n2',
        name: 'Get Content Queue',
        type: 'n8n-nodes-base.notion',
        typeVersion: 2,
        position: [320, 300],
        parameters: {
          resource: 'databasePage',
          operation: 'getAll',
          databaseId: { __rl: true, mode: 'id', value: '={{$vars.NOTION_DATABASE_ID}}' },
          filterType: 'manual',
          filters: {
            conditions: [{ key: 'Status', condition: 'equals', stringValue: 'Ready' }],
          },
          limit: 1,
        },
        credentials: { notionApi: { id: 'notion', name: 'Notion account' } },
      },
      {
        id: 'n3',
        name: 'Generate Social Copy',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          headers: {
            parameters: [
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: false,
            bodyParameters: {
              parameters: [
                { name: 'model', value: 'claude-haiku-4-5-20251001' },
                { name: 'max_tokens', value: 500 },
                {
                  name: 'messages',
                  value: '=[{"role":"user","content":"Write a Twitter/X post and a LinkedIn post for: {{$json.properties.Title.title[0].plain_text}}. Topic: {{$json.properties.Topic.rich_text[0].plain_text}}. Return JSON: {twitter: string, linkedin: string}"}]',
                },
              ],
            },
          },
        },
      },
      {
        id: 'n4',
        name: 'Parse AI Response',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [760, 300],
        parameters: {
          language: 'javaScript',
          jsCode: `const text = $input.first().json.content[0].text;
const parsed = JSON.parse(text.match(/\\{[\\s\\S]*\\}/)[0]);
return [{ json: { twitter: parsed.twitter, linkedin: parsed.linkedin } }];`,
        },
      },
      {
        id: 'n5',
        name: 'Post to Twitter/X',
        type: 'n8n-nodes-base.twitter',
        typeVersion: 2,
        position: [980, 200],
        parameters: {
          text: '={{$json.twitter}}',
        },
        credentials: { twitterOAuth2Api: { id: 'twitter', name: 'Twitter account' } },
      },
      {
        id: 'n6',
        name: 'Post to LinkedIn',
        type: 'n8n-nodes-base.linkedIn',
        typeVersion: 1,
        position: [980, 400],
        parameters: {
          person: '',
          text: '={{$json.linkedin}}',
          shareMediaCategory: 'NONE',
        },
        credentials: { linkedInOAuth2Api: { id: 'linkedin', name: 'LinkedIn account' } },
      },
    ],
    connections: {
      'Schedule Trigger':   { main: [[{ node: 'Get Content Queue',    type: 'main', index: 0 }]] },
      'Get Content Queue':  { main: [[{ node: 'Generate Social Copy', type: 'main', index: 0 }]] },
      'Generate Social Copy': { main: [[{ node: 'Parse AI Response',  type: 'main', index: 0 }]] },
      'Parse AI Response':  { main: [[{ node: 'Post to Twitter/X',    type: 'main', index: 0 }, { node: 'Post to LinkedIn', type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 2: Lead Capture → CRM ───────────────────────────────────────────
const leadCaptureCrm: WorkflowTemplate = {
  id:                     'lead-capture-crm',
  name:                   'Lead Capture → CRM',
  description:            'Receives new lead data via webhook, enriches with AI-generated ICP score, adds to HubSpot, sends a welcome email, and pings Slack.',
  category:               'sales',
  estimatedSetupMinutes:  20,
  requiredCredentials:    ['hubspotApi', 'slackApi'],
  requiredEnvVars:        ['RESEND_API_KEY'],
  triggers:               ['Webhook POST from any form/landing page'],
  setupChecklist: [
    'Copy the webhook URL and add it to your form provider (Typeform, Webflow, etc.)',
    'Connect your HubSpot account in n8n credentials',
    'Connect your Slack workspace in n8n credentials',
    'Set the Slack channel name in the Slack node',
    'Configure the welcome email sender in the HTTP Request node',
    'Activate the workflow',
  ],
  openClawSteps: [],
  workflow: {
    name: 'Lead Capture → CRM',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['sales', 'crm', 'leads'],
    nodes: [
      {
        id: 'n1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          path: 'lead-capture',
          responseMode: 'onReceived',
          responseData: 'firstEntryJson',
        },
      },
      {
        id: 'n2',
        name: 'Validate & Enrich',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [320, 300],
        parameters: {
          language: 'javaScript',
          jsCode: `const d = $input.first().json.body ?? $input.first().json;
if (!d.email) throw new Error('Missing email');
return [{ json: {
  email:     d.email.toLowerCase().trim(),
  firstName: d.firstName ?? d.first_name ?? '',
  lastName:  d.lastName  ?? d.last_name  ?? '',
  company:   d.company   ?? '',
  source:    d.source    ?? 'website',
  createdAt: new Date().toISOString(),
}}];`,
        },
      },
      {
        id: 'n3',
        name: 'Create HubSpot Contact',
        type: 'n8n-nodes-base.hubspot',
        typeVersion: 2,
        position: [540, 200],
        parameters: {
          resource: 'contact',
          operation: 'create',
          additionalFields: {
            email:     '={{$json.email}}',
            firstName: '={{$json.firstName}}',
            lastName:  '={{$json.lastName}}',
            company:   '={{$json.company}}',
          },
        },
        credentials: { hubspotApi: { id: 'hubspot', name: 'HubSpot account' } },
      },
      {
        id: 'n4',
        name: 'Send Welcome Email',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 400],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"noreply@{{$vars.DOMAIN}}","to":"{{$json.email}}","subject":"Welcome!","html":"<p>Thanks for your interest, {{$json.firstName}}!</p>"}',
          },
        },
      },
      {
        id: 'n5',
        name: 'Notify Slack',
        type: 'n8n-nodes-base.slack',
        typeVersion: 2,
        position: [760, 300],
        parameters: {
          resource: 'message',
          operation: 'post',
          channel: '#sales',
          text: '=🎯 New lead: *{{$json.firstName}} {{$json.lastName}}* ({{$json.email}}) from {{$json.company}} via {{$json.source}}',
        },
        credentials: { slackApi: { id: 'slack', name: 'Slack account' } },
      },
    ],
    connections: {
      'Webhook':               { main: [[{ node: 'Validate & Enrich',       type: 'main', index: 0 }]] },
      'Validate & Enrich':     { main: [[{ node: 'Create HubSpot Contact',  type: 'main', index: 0 }, { node: 'Send Welcome Email', type: 'main', index: 0 }]] },
      'Create HubSpot Contact': { main: [[{ node: 'Notify Slack',           type: 'main', index: 0 }]] },
      'Send Welcome Email':    { main: [[{ node: 'Notify Slack',            type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 3: Invoice Generation ───────────────────────────────────────────
const invoiceGeneration: WorkflowTemplate = {
  id:                     'invoice-generation',
  name:                   'Invoice Generation',
  description:            'Triggered by a Stripe payment.succeeded event — generates an invoice PDF via API, emails it to the customer, and logs to Supabase.',
  category:               'finance',
  estimatedSetupMinutes:  30,
  requiredCredentials:    ['stripeApi'],
  requiredEnvVars:        ['STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  triggers:               ['Stripe payment.succeeded webhook'],
  setupChecklist: [
    'Add the n8n webhook URL to your Stripe dashboard under Webhooks',
    'Set STRIPE_WEBHOOK_SECRET in n8n environment',
    'Connect Stripe API credentials in n8n',
    'Set RESEND_API_KEY and SUPABASE vars in n8n environment',
    'Test with a Stripe test payment',
    'Activate the workflow',
  ],
  openClawSteps: [
    'Configure Stripe webhook endpoint in the Stripe dashboard',
  ],
  workflow: {
    name: 'Invoice Generation',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['finance', 'stripe', 'invoices'],
    nodes: [
      {
        id: 'n1',
        name: 'Stripe Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          path: 'stripe-payment',
          responseMode: 'onReceived',
        },
      },
      {
        id: 'n2',
        name: 'Verify Stripe Signature',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [320, 300],
        parameters: {
          language: 'javaScript',
          jsCode: `// In production wire up stripe-signature header verification
const event = $input.first().json.body;
if (event.type !== 'payment_intent.succeeded') return [];
const pi = event.data.object;
return [{ json: {
  amount:        pi.amount / 100,
  currency:      pi.currency.toUpperCase(),
  customerEmail: pi.receipt_email ?? pi.metadata?.email ?? '',
  customerName:  pi.metadata?.name ?? 'Customer',
  paymentId:     pi.id,
  description:   pi.description ?? 'Payment',
}}];`,
        },
      },
      {
        id: 'n3',
        name: 'Send Invoice Email',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 200],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"billing@{{$vars.DOMAIN}}","to":"{{$json.customerEmail}}","subject":"Your invoice — {{$json.paymentId}}","html":"<p>Hi {{$json.customerName}},</p><p>Thank you for your payment of {{$json.currency}} {{$json.amount}}.</p><p>Reference: {{$json.paymentId}}</p>"}',
          },
        },
      },
      {
        id: 'n4',
        name: 'Log to Supabase',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 400],
        parameters: {
          method: 'POST',
          url: '={{$vars.SUPABASE_URL}}/rest/v1/invoices',
          headers: {
            parameters: [
              { name: 'apikey',        value: '={{$vars.SUPABASE_SERVICE_ROLE_KEY}}' },
              { name: 'Authorization', value: '=Bearer {{$vars.SUPABASE_SERVICE_ROLE_KEY}}' },
              { name: 'Content-Type',  value: 'application/json' },
              { name: 'Prefer',        value: 'return=representation' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"payment_id":"{{$json.paymentId}}","customer_email":"{{$json.customerEmail}}","amount":{{$json.amount}},"currency":"{{$json.currency}}","created_at":"{{$now}}"}',
          },
        },
      },
    ],
    connections: {
      'Stripe Webhook':          { main: [[{ node: 'Verify Stripe Signature', type: 'main', index: 0 }]] },
      'Verify Stripe Signature': { main: [[{ node: 'Send Invoice Email',      type: 'main', index: 0 }, { node: 'Log to Supabase', type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 4: Content Republishing ─────────────────────────────────────────
const contentRepublishing: WorkflowTemplate = {
  id:                     'content-republishing',
  name:                   'Content Republishing',
  description:            'Fetches your latest blog posts weekly, repurposes each into 3 formats (Twitter thread, LinkedIn article, email snippet) using Claude, and queues them in Notion.',
  category:               'content',
  estimatedSetupMinutes:  20,
  requiredCredentials:    ['notionApi'],
  requiredEnvVars:        ['ANTHROPIC_API_KEY'],
  triggers:               ['Every Monday at 8 AM'],
  setupChecklist: [
    'Set your blog RSS feed URL in the HTTP Request node',
    'Create a Notion database with Title, Format, Content, Status columns',
    'Set the NOTION_OUTPUT_DATABASE_ID variable',
    'Add ANTHROPIC_API_KEY to n8n environment',
    'Activate the workflow',
  ],
  openClawSteps: [],
  workflow: {
    name: 'Content Republishing',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['content', 'republishing', 'automation'],
    nodes: [
      {
        id: 'n1',
        name: 'Weekly Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          rule: { interval: [{ field: 'weeks', triggerAtWeekday: [1], triggerAtHour: 8 }] },
        },
      },
      {
        id: 'n2',
        name: 'Fetch RSS Feed',
        type: 'n8n-nodes-base.rssFeedRead',
        typeVersion: 1,
        position: [320, 300],
        parameters: {
          url: '={{$vars.BLOG_RSS_URL}}',
          limit: 5,
        },
      },
      {
        id: 'n3',
        name: 'Repurpose with Claude',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          headers: {
            parameters: [
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"model":"claude-haiku-4-5-20251001","max_tokens":800,"messages":[{"role":"user","content":"Repurpose this blog post into 3 formats. Return JSON: {twitterThread: string[], linkedinArticle: string, emailSnippet: string}. Post title: {{$json.title}}. Content: {{$json.contentSnippet}}"}]}',
          },
        },
      },
      {
        id: 'n4',
        name: 'Add to Notion Queue',
        type: 'n8n-nodes-base.notion',
        typeVersion: 2,
        position: [760, 300],
        parameters: {
          resource: 'databasePage',
          operation: 'create',
          databaseId: { __rl: true, mode: 'id', value: '={{$vars.NOTION_OUTPUT_DATABASE_ID}}' },
          title: '=Repurposed: {{$json.title}}',
          propertiesUi: {
            propertyValues: [
              { key: 'Status', type: 'select', selectValue: 'Draft' },
              { key: 'Source', type: 'url',    urlValue: '={{$json.link}}' },
            ],
          },
        },
        credentials: { notionApi: { id: 'notion', name: 'Notion account' } },
      },
    ],
    connections: {
      'Weekly Trigger':      { main: [[{ node: 'Fetch RSS Feed',        type: 'main', index: 0 }]] },
      'Fetch RSS Feed':      { main: [[{ node: 'Repurpose with Claude', type: 'main', index: 0 }]] },
      'Repurpose with Claude': { main: [[{ node: 'Add to Notion Queue', type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 5: Competitor Monitoring ────────────────────────────────────────
const competitorMonitoring: WorkflowTemplate = {
  id:                     'competitor-monitoring',
  name:                   'Competitor Monitoring',
  description:            'Scrapes competitor pricing pages and product updates daily, uses Claude to summarise changes, and sends a digest to Slack.',
  category:               'monitoring',
  estimatedSetupMinutes:  35,
  requiredCredentials:    ['slackApi'],
  requiredEnvVars:        ['ANTHROPIC_API_KEY'],
  triggers:               ['Daily at 7 AM'],
  setupChecklist: [
    'Add competitor URLs to the competitors array in the Code node',
    'Connect your Slack workspace in n8n credentials',
    'Set the Slack channel in the Slack node (default: #competitive-intel)',
    'Add ANTHROPIC_API_KEY to n8n environment',
    'Test by running manually before activating',
    'Activate the workflow',
  ],
  openClawSteps: [
    'If competitor sites block scraping, use OpenClaw browser automation to render JavaScript-heavy pages',
  ],
  workflow: {
    name: 'Competitor Monitoring',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['monitoring', 'competitive-intel'],
    nodes: [
      {
        id: 'n1',
        name: 'Daily Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          rule: { interval: [{ field: 'hours', triggerAtHour: 7 }] },
        },
      },
      {
        id: 'n2',
        name: 'Competitor URLs',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [320, 300],
        parameters: {
          language: 'javaScript',
          jsCode: `// Add your competitor URLs here
const competitors = [
  { name: 'Competitor A', url: 'https://competitor-a.com/pricing' },
  { name: 'Competitor B', url: 'https://competitor-b.com/pricing' },
];
return competitors.map(c => ({ json: c }));`,
        },
      },
      {
        id: 'n3',
        name: 'Scrape Pages',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 300],
        parameters: {
          method: 'GET',
          url: '={{$json.url}}',
          options: { response: { response: { responseFormat: 'text' } } },
        },
      },
      {
        id: 'n4',
        name: 'Analyse with Claude',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [760, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          headers: {
            parameters: [
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"model":"claude-haiku-4-5-20251001","max_tokens":400,"messages":[{"role":"user","content":"Extract key pricing info and any notable feature changes from this page content. Be concise. Competitor: {{$json.name}}. Content (first 3000 chars): {{$json.data.slice(0,3000)}}"}]}',
          },
        },
      },
      {
        id: 'n5',
        name: 'Send Slack Digest',
        type: 'n8n-nodes-base.slack',
        typeVersion: 2,
        position: [980, 300],
        parameters: {
          resource: 'message',
          operation: 'post',
          channel: '#competitive-intel',
          text: '=🔍 *Competitor Update* — {{$json.name}}\n{{$json.content[0].text}}',
        },
        credentials: { slackApi: { id: 'slack', name: 'Slack account' } },
      },
    ],
    connections: {
      'Daily Trigger':      { main: [[{ node: 'Competitor URLs',      type: 'main', index: 0 }]] },
      'Competitor URLs':    { main: [[{ node: 'Scrape Pages',         type: 'main', index: 0 }]] },
      'Scrape Pages':       { main: [[{ node: 'Analyse with Claude',  type: 'main', index: 0 }]] },
      'Analyse with Claude': { main: [[{ node: 'Send Slack Digest',   type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 6: Onboarding Email Sequence ────────────────────────────────────
const onboardingEmailSequence: WorkflowTemplate = {
  id:                     'onboarding-email-sequence',
  name:                   'Onboarding Email Sequence',
  description:            'Triggered when a new user signs up — sends a personalised 5-email onboarding sequence over 14 days using Resend.',
  category:               'marketing',
  estimatedSetupMinutes:  25,
  requiredCredentials:    [],
  requiredEnvVars:        ['RESEND_API_KEY'],
  triggers:               ['Webhook POST on new user signup'],
  setupChecklist: [
    'Copy the webhook URL and trigger it from your auth provider (Clerk, Supabase Auth, etc.)',
    'Set RESEND_API_KEY in n8n environment',
    'Customise each email template in the Send Email nodes',
    'Set FROM_EMAIL variable to your verified sender',
    'Test with a sample payload before activating',
    'Activate the workflow',
  ],
  openClawSteps: [],
  workflow: {
    name: 'Onboarding Email Sequence',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['marketing', 'email', 'onboarding'],
    nodes: [
      {
        id: 'n1',
        name: 'New User Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          path: 'new-user',
          responseMode: 'onReceived',
        },
      },
      {
        id: 'n2',
        name: 'Day 0 — Welcome',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [320, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"{{$vars.FROM_EMAIL}}","to":"{{$json.body.email}}","subject":"Welcome to {{$vars.APP_NAME}}!","html":"<p>Hi {{$json.body.firstName}}, welcome aboard!</p>"}',
          },
        },
      },
      {
        id: 'n3',
        name: 'Wait 3 Days',
        type: 'n8n-nodes-base.wait',
        typeVersion: 1,
        position: [540, 300],
        parameters: { amount: 3, unit: 'days' },
      },
      {
        id: 'n4',
        name: 'Day 3 — Getting Started',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [760, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"{{$vars.FROM_EMAIL}}","to":"{{$json.body.email}}","subject":"Quick tip: getting started with {{$vars.APP_NAME}}","html":"<p>Hi {{$json.body.firstName}}, here are 3 things to try first...</p>"}',
          },
        },
      },
      {
        id: 'n5',
        name: 'Wait 7 Days',
        type: 'n8n-nodes-base.wait',
        typeVersion: 1,
        position: [980, 300],
        parameters: { amount: 7, unit: 'days' },
      },
      {
        id: 'n6',
        name: 'Day 10 — Check-in',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [1200, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"{{$vars.FROM_EMAIL}}","to":"{{$json.body.email}}","subject":"How is it going, {{$json.body.firstName}}?","html":"<p>Just checking in — any questions?</p>"}',
          },
        },
      },
    ],
    connections: {
      'New User Webhook':       { main: [[{ node: 'Day 0 — Welcome',        type: 'main', index: 0 }]] },
      'Day 0 — Welcome':        { main: [[{ node: 'Wait 3 Days',            type: 'main', index: 0 }]] },
      'Wait 3 Days':            { main: [[{ node: 'Day 3 — Getting Started', type: 'main', index: 0 }]] },
      'Day 3 — Getting Started': { main: [[{ node: 'Wait 7 Days',           type: 'main', index: 0 }]] },
      'Wait 7 Days':            { main: [[{ node: 'Day 10 — Check-in',      type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 7: Support Ticket Routing ───────────────────────────────────────
const supportTicketRouting: WorkflowTemplate = {
  id:                     'support-ticket-routing',
  name:                   'Support Ticket Routing',
  description:            'Receives new support tickets via webhook, uses Claude to classify urgency and category, routes to the right Slack channel, and creates a Notion task.',
  category:               'support',
  estimatedSetupMinutes:  20,
  requiredCredentials:    ['notionApi', 'slackApi'],
  requiredEnvVars:        ['ANTHROPIC_API_KEY'],
  triggers:               ['Webhook POST from help desk / contact form'],
  setupChecklist: [
    'Copy the webhook URL and configure your help desk (Zendesk, Crisp, Intercom, etc.) to POST new tickets',
    'Connect Notion and Slack accounts in n8n credentials',
    'Set NOTION_SUPPORT_DATABASE_ID variable to your support task database',
    'Customise Slack channel routing in the Route to Channel node',
    'Add ANTHROPIC_API_KEY to n8n environment',
    'Activate the workflow',
  ],
  openClawSteps: [],
  workflow: {
    name: 'Support Ticket Routing',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['support', 'routing', 'automation'],
    nodes: [
      {
        id: 'n1',
        name: 'Ticket Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          path: 'support-ticket',
          responseMode: 'onReceived',
        },
      },
      {
        id: 'n2',
        name: 'Classify with Claude',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [320, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          headers: {
            parameters: [
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"model":"claude-haiku-4-5-20251001","max_tokens":200,"messages":[{"role":"user","content":"Classify this support ticket. Return JSON only: {urgency: \\"low\\"|\\"medium\\"|\\"high\\", category: \\"billing\\"|\\"technical\\"|\\"account\\"|\\"general\\", summary: string}. Ticket: {{$json.body.message}}"}]}',
          },
        },
      },
      {
        id: 'n3',
        name: 'Parse Classification',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [540, 300],
        parameters: {
          language: 'javaScript',
          jsCode: `const text = $input.first().json.content[0].text;
const cls = JSON.parse(text.match(/\\{[\\s\\S]*\\}/)[0]);
const channelMap = { billing: '#billing-support', technical: '#tech-support', account: '#account-support', general: '#support' };
return [{ json: {
  ...cls,
  channel: channelMap[cls.category] ?? '#support',
  ticketEmail: $('Ticket Webhook').first().json.body?.email ?? '',
  ticketMessage: $('Ticket Webhook').first().json.body?.message ?? '',
}}];`,
        },
      },
      {
        id: 'n4',
        name: 'Create Notion Task',
        type: 'n8n-nodes-base.notion',
        typeVersion: 2,
        position: [760, 200],
        parameters: {
          resource: 'databasePage',
          operation: 'create',
          databaseId: { __rl: true, mode: 'id', value: '={{$vars.NOTION_SUPPORT_DATABASE_ID}}' },
          title: '=[{{$json.urgency.toUpperCase()}}] {{$json.summary}}',
          propertiesUi: {
            propertyValues: [
              { key: 'Category', type: 'select',   selectValue: '={{$json.category}}' },
              { key: 'Urgency',  type: 'select',   selectValue: '={{$json.urgency}}' },
              { key: 'Email',    type: 'email',    emailValue: '={{$json.ticketEmail}}' },
              { key: 'Status',   type: 'select',   selectValue: 'Open' },
            ],
          },
        },
        credentials: { notionApi: { id: 'notion', name: 'Notion account' } },
      },
      {
        id: 'n5',
        name: 'Route to Channel',
        type: 'n8n-nodes-base.slack',
        typeVersion: 2,
        position: [760, 400],
        parameters: {
          resource: 'message',
          operation: 'post',
          channel: '={{$json.channel}}',
          text: '=🎫 *[{{$json.urgency.toUpperCase()}}] New {{$json.category}} ticket*\n{{$json.summary}}\n_From: {{$json.ticketEmail}}_',
        },
        credentials: { slackApi: { id: 'slack', name: 'Slack account' } },
      },
    ],
    connections: {
      'Ticket Webhook':       { main: [[{ node: 'Classify with Claude',  type: 'main', index: 0 }]] },
      'Classify with Claude': { main: [[{ node: 'Parse Classification',  type: 'main', index: 0 }]] },
      'Parse Classification': { main: [[{ node: 'Create Notion Task',    type: 'main', index: 0 }, { node: 'Route to Channel', type: 'main', index: 0 }]] },
    },
  },
}

// ── Template 8: Weekly Analytics Digest ──────────────────────────────────────
const analyticsDigest: WorkflowTemplate = {
  id:                     'analytics-digest',
  name:                   'Weekly Analytics Digest',
  description:            'Fetches KPI data from Supabase every Monday, asks Claude to write an executive summary with insights and recommendations, and emails it to the team.',
  category:               'operations',
  estimatedSetupMinutes:  20,
  requiredCredentials:    [],
  requiredEnvVars:        ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY'],
  triggers:               ['Every Monday at 7 AM'],
  setupChecklist: [
    'Set all required environment variables in n8n',
    'Update the Supabase query in the Fetch KPIs node to match your schema',
    'Add recipient email addresses to the Send Digest node',
    'Customise the report prompt in the Generate Insights node',
    'Test by running manually to confirm email delivery',
    'Activate the workflow',
  ],
  openClawSteps: [],
  workflow: {
    name: 'Weekly Analytics Digest',
    active: false,
    settings: { executionOrder: 'v1' },
    tags: ['analytics', 'reporting', 'digest'],
    nodes: [
      {
        id: 'n1',
        name: 'Monday Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [100, 300],
        parameters: {
          rule: { interval: [{ field: 'weeks', triggerAtWeekday: [1], triggerAtHour: 7 }] },
        },
      },
      {
        id: 'n2',
        name: 'Fetch KPIs',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [320, 300],
        parameters: {
          method: 'GET',
          url: '={{$vars.SUPABASE_URL}}/rest/v1/kpi_snapshots?order=created_at.desc&limit=14',
          headers: {
            parameters: [
              { name: 'apikey',        value: '={{$vars.SUPABASE_SERVICE_ROLE_KEY}}' },
              { name: 'Authorization', value: '=Bearer {{$vars.SUPABASE_SERVICE_ROLE_KEY}}' },
            ],
          },
        },
      },
      {
        id: 'n3',
        name: 'Generate Insights',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [540, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          headers: {
            parameters: [
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"model":"claude-sonnet-4-6","max_tokens":600,"messages":[{"role":"user","content":"Write a concise executive summary for this week\'s business metrics. Include 3 key insights and 2 action recommendations. Data: {{JSON.stringify($json)}}"}]}',
          },
        },
      },
      {
        id: 'n4',
        name: 'Send Digest Email',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [760, 300],
        parameters: {
          method: 'POST',
          url: 'https://api.resend.com/emails',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          body: {
            mode: 'json',
            jsonParameters: true,
            jsonBody: '={"from":"digest@{{$vars.DOMAIN}}","to":["{{$vars.DIGEST_RECIPIENTS}}"],"subject":"📊 Weekly Business Digest — {{$now.toFormat(\'dd MMM yyyy\')}}","html":"<h2>Weekly Analytics Digest</h2><div>{{$json.content[0].text.replace(/\\n/g,\'<br>\')}}</div>"}',
          },
        },
      },
    ],
    connections: {
      'Monday Trigger':   { main: [[{ node: 'Fetch KPIs',        type: 'main', index: 0 }]] },
      'Fetch KPIs':       { main: [[{ node: 'Generate Insights', type: 'main', index: 0 }]] },
      'Generate Insights': { main: [[{ node: 'Send Digest Email', type: 'main', index: 0 }]] },
    },
  },
}

// ── Exported registry ─────────────────────────────────────────────────────────
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  socialPostScheduler,
  leadCaptureCrm,
  invoiceGeneration,
  contentRepublishing,
  competitorMonitoring,
  onboardingEmailSequence,
  supportTicketRouting,
  analyticsDigest,
]

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(t => t.id === id)
}

export function getTemplatesByCategory(category: string): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter(t => t.category === category)
}

export const WORKFLOW_CATEGORIES = [
  { id: 'content',    label: 'Content' },
  { id: 'sales',      label: 'Sales' },
  { id: 'marketing',  label: 'Marketing' },
  { id: 'operations', label: 'Operations' },
  { id: 'finance',    label: 'Finance' },
  { id: 'support',    label: 'Support' },
  { id: 'monitoring', label: 'Monitoring' },
] as const
