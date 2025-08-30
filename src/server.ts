import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Version3Client } from 'jira.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from both locations
dotenv.config();
try {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch (e) {
  console.error("Error loading .env file:", e);
}

// Initialize Jira client
const jira = new Version3Client({
  host: process.env.JIRA_HOST!,
  authentication: {
    basic: {
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!,
    },
  },
});

// Type definitions
interface JiraTicket {
  summary: string;
  description: string;
  projectKey: string;
  issueType: string;
  parent?: string; // Optional parent/epic key for next-gen projects
}

interface JiraComment {
  body: string;
}

interface StatusUpdate {
  transitionId: string;
}

// Validation schemas
const TicketSchema = z.object({
  summary: z.string().describe("The ticket summary"),
  description: z.string().describe("The ticket description"),
  projectKey: z.string().describe("The project key (e.g., PROJECT)"),
  issueType: z.string().describe("The type of issue (e.g., Task, Bug)"),
  parent: z.string().optional().describe("The parent/epic key (for next-gen projects)"),
});

const CommentSchema = z.object({
  body: z.string().describe("The comment text"),
});

const StatusUpdateSchema = z.object({
  transitionId: z.string().describe("The ID of the transition to perform"),
});

// Helper function to recursively extract text from ADF nodes
function extractTextFromADF(node: any): string {
  if (!node) {
    return '';
  }

  // Handle text nodes directly
  if (node.type === 'text' && node.text) {
    return node.text;
  }

  let text = '';
  // Handle block nodes like paragraph, heading, etc.
  if (node.content && Array.isArray(node.content)) {
    text = node.content.map(extractTextFromADF).join('');
    // Add a newline after paragraphs for better formatting
    if (node.type === 'paragraph') {
      text += '\n';
    }
  }

  return text;
}

// Helper function to validate Jira configuration
function validateJiraConfig(): string | null {
  if (!process.env.JIRA_HOST) return "JIRA_HOST environment variable is not set";
  if (!process.env.JIRA_EMAIL) return "JIRA_EMAIL environment variable is not set";
  if (!process.env.JIRA_API_TOKEN) return "JIRA_API_TOKEN environment variable is not set";
  return null;
}

// Helper function to validate and format project keys
function validateAndFormatProjectKeys(projectKeys: string): string[] {
  return projectKeys
    .split(',')
    .map(key => key.trim().toUpperCase())
    .filter(key => key.length > 0);
}

// Helper function to escape special characters in JQL text search
function escapeJQLText(text: string): string {
  // Escape special characters: + - & | ! ( ) { } [ ] ^ ~ * ? \ /
  return text.replace(/[+\-&|!(){}[\]^~*?\\\/]/g, '\\$&');
}

// Create server instance
const server = new McpServer({
  name: "jira",
  version: "1.0.0"
});

// Register tools
server.tool(
  "list_tickets",
  "List Jira tickets assigned to you",
  {
    jql: z.string().optional().describe("Optional JQL query to filter tickets"),
  },
  async ({ jql }: { jql?: string }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      const query = jql || 'ORDER BY updated DESC';
      const tickets = await jira.issueSearch.searchForIssuesUsingJql({ jql: query });
      
      if (!tickets.issues || tickets.issues.length === 0) {
        return {
          content: [{ type: "text", text: "No tickets found" }],
        };
      }

      const formattedTickets = tickets.issues.map((issue) => {
        const summary = issue.fields?.summary || 'No summary';
        const status = issue.fields?.status?.name || 'Unknown status';
        return `${issue.key}: ${summary} (${status})`;
      }).join('\n');

      return {
        content: [{ type: "text", text: formattedTickets }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to fetch tickets: ${(error as Error).message}` }],
      };
    }
  }
);

server.tool(
  "get_ticket",
  "Get details of a specific Jira ticket",
  {
    ticketId: z.string().describe("The Jira ticket ID (e.g., PROJECT-123)"),
  },
  async ({ ticketId }: { ticketId: string }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      const ticket = await jira.issues.getIssue({
        issueIdOrKey: ticketId,
        fields: ['summary', 'status', 'issuetype', 'description', 'parent', 'issuelinks'],
      });

      const formattedTicket = [
        `Key: ${ticket.key}`,
        `Summary: ${ticket.fields?.summary || 'No summary'}`,
        `Status: ${ticket.fields?.status?.name || 'Unknown status'}`,
        `Type: ${ticket.fields?.issuetype?.name || 'Unknown type'}`,
        `Description:\n${extractTextFromADF(ticket.fields?.description) || 'No description'}`,
        `Parent: ${ticket.fields?.parent?.key || 'No parent'}`
      ];

      // Linked Issues Section
      const links = ticket.fields?.issuelinks || [];
      if (Array.isArray(links) && links.length > 0) {
        formattedTicket.push('\nLinked Issues:');
        for (const link of links) {
          // Outward (this issue is the source)
          if (link.outwardIssue) {
            const key = link.outwardIssue.key;
            const summary = link.outwardIssue.fields?.summary || 'No summary';
            const type = link.type?.outward || link.type?.name || 'Related';
            formattedTicket.push(`- [${type}] ${key}: ${summary}`);
          }
          // Inward (this issue is the target)
          if (link.inwardIssue) {
            const key = link.inwardIssue.key;
            const summary = link.inwardIssue.fields?.summary || 'No summary';
            const type = link.type?.inward || link.type?.name || 'Related';
            formattedTicket.push(`- [${type}] ${key}: ${summary}`);
          }
        }
      } else {
        formattedTicket.push('\nLinked Issues: None');
      }

      return {
        content: [{ type: "text", text: formattedTicket.join('\n') }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to fetch ticket: ${(error as Error).message}` }],
      };
    }
  }
);

server.tool(
  "get_comments",
  "Get comments for a specific Jira ticket",
  {
    ticketId: z.string().describe("The Jira ticket ID (e.g., PROJECT-123)"),
  },
  async ({ ticketId }: { ticketId: string }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      const commentsResult = await jira.issueComments.getComments({ issueIdOrKey: ticketId });
      
      if (!commentsResult.comments || commentsResult.comments.length === 0) {
        return {
          content: [{ type: "text", text: "No comments found for this ticket." }],
        };
      }

      const formattedComments = commentsResult.comments.map(comment => {
        const author = comment.author?.displayName || 'Unknown Author';
        // Comments also use ADF, so we need to parse them
        const body = extractTextFromADF(comment.body) || 'No comment body'; 
        const createdDate = comment.created ? new Date(comment.created).toLocaleString() : 'Unknown date';
        return `[${createdDate}] ${author}:\n${body.trim()}\n---`; // Added trim() and separator
      }).join('\n\n'); // Separate comments with double newline

      return {
        content: [{ type: "text", text: formattedComments }],
      };
    } catch (error) {
      // Handle cases where the ticket might not exist or other API errors
      if ((error as any).response?.status === 404) {
          return {
              content: [{ type: "text", text: `Ticket ${ticketId} not found.` }],
          };
      }
      return {
        content: [{ type: "text", text: `Failed to fetch comments: ${(error as Error).message}` }],
      };
    }
  }
);

server.tool(
  "create_ticket",
  "Create a new Jira ticket",
  {
    ticket: TicketSchema,
  },
  async ({ ticket }: { ticket: JiraTicket }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      const fields: any = {
        project: { key: ticket.projectKey },
        summary: ticket.summary,
        description: ticket.description,
        issuetype: { name: ticket.issueType },
      };

      // Add parent/epic link if specified
      if (ticket.parent) {
        fields.parent = { key: ticket.parent };
      }

      const newTicket = await jira.issues.createIssue({
        fields: fields,
      });

      return {
        content: [{ type: "text", text: `Created ticket: ${newTicket.key}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to create ticket: ${(error as Error).message}` }],
      };
    }
  }
);

server.tool(
  "add_comment",
  "Add a comment to a Jira ticket",
  {
    ticketId: z.string().describe("The Jira ticket ID"),
    comment: CommentSchema,
  },
  async ({ ticketId, comment }: { ticketId: string; comment: JiraComment }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      await jira.issueComments.addComment({
        issueIdOrKey: ticketId,
        comment: comment.body,
      });

      return {
        content: [{ type: "text", text: `Added comment to ${ticketId}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add comment: ${(error as Error).message}` }],
      };
    }
  }
);

server.tool(
  "update_status",
  "Update the status of a Jira ticket",
  {
    ticketId: z.string().describe("The Jira ticket ID"),
    status: StatusUpdateSchema,
  },
  async ({ ticketId, status }: { ticketId: string; status: StatusUpdate }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }
let statusCategories;
    try {
      await jira.issues.doTransition({
        issueIdOrKey: ticketId,
        transition: { id: status.transitionId },
      });
// map status categories to status name and transition ids
      statusCategories = await jira.workflowStatusCategories.getStatusCategories().then(res => res.values)  ;
      return {
        content: [{ type: "text", text: `Updated status of ${ticketId} ${statusCategories}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update status: ${(error as Error).message} ${statusCategories}` }],
      };
    }
  }
);

server.tool(
  "search_tickets",
  "Search for tickets in specific projects using text search",
  {
    searchText: z.string().describe("The text to search for in tickets"),
    projectKeys: z.string().describe("Comma-separated list of project keys"),
    maxResults: z.number().optional().describe("Maximum number of results to return"),
  },
  async ({ searchText, projectKeys, maxResults = 50 }: { searchText: string; projectKeys: string; maxResults?: number }) => {
    const configError = validateJiraConfig();
    if (configError) {
      return {
        content: [{ type: "text", text: `Configuration error: ${configError}` }],
      };
    }

    try {
      // Validate and format project keys
      const projects = validateAndFormatProjectKeys(projectKeys);
      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "No valid project keys provided. Please provide at least one project key." }],
        };
      }

      // Escape the search text for JQL
      const escapedText = escapeJQLText(searchText);

      // Construct the JQL query
      const jql = `text ~ "${escapedText}" AND project IN (${projects.join(',')}) ORDER BY updated DESC`;

      // Execute the search with description field included
      const searchResults = await jira.issueSearch.searchForIssuesUsingJql({
        jql,
        maxResults,
        fields: ['summary', 'status', 'updated', 'project', 'description'],
      });

      if (!searchResults.issues || searchResults.issues.length === 0) {
        return {
          content: [{ type: "text", text: `No tickets found matching "${searchText}" in projects: ${projects.join(', ')}` }],
        };
      }

      // Format the results with descriptions
      const formattedResults = searchResults.issues.map(issue => {
        const summary = issue.fields?.summary || 'No summary';
        const status = issue.fields?.status?.name || 'Unknown status';
        const project = issue.fields?.project?.key || 'Unknown project';
        const updated = issue.fields?.updated ? 
          new Date(issue.fields.updated).toLocaleString() :
          'Unknown date';
        const description = issue.fields?.description ? 
          extractTextFromADF(issue.fields.description) : 
          'No description';
        
        return `[${project}] ${issue.key}: ${summary}
Status: ${status} (Updated: ${updated})
Description:
${description.trim()}
----------------------------------------\n`;
      }).join('\n');

      const totalResults = searchResults.total || 0;
      const headerText = `Found ${totalResults} ticket${totalResults !== 1 ? 's' : ''} matching "${searchText}"\n\n`;

      return {
        content: [{ type: "text", text: headerText + formattedResults }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        content: [{ type: "text", text: `Failed to search tickets: ${errorMessage}` }],
      };
    }
  }
);

// Start the server
async function main() {
  try {
    // Check Jira configuration
    const configError = validateJiraConfig();
    if (configError) {
      console.error(`Jira configuration error: ${configError}`);
      console.error("Please configure the required environment variables.");
      console.error("Starting server in limited mode (tools will return configuration instructions)");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Jira MCP Server running on stdio");
  } catch (error) {
    console.error("Error starting Jira MCP server:", error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.error('Received SIGINT signal, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM signal, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
}); 