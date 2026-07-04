import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { computeIncomeTax, ComputeIncomeTaxInput, computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, configHash } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';

// 1. Initialize MCP Server
const server = new Server(
  {
    name: 'uk-tax-calculation-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 2. Define Tool Schema Inventory
const TOOLS = [
  {
    name: 'compute_income_tax',
    description: 'Computes UK personal income tax for a given tax year, including allowances and band allocations.',
    inputSchema: {
      type: 'object',
      properties: {
        taxYear: { type: 'string', description: 'Tax year, e.g. "2025-26"' },
        region: { type: 'string', enum: ['rUK', 'scotland', 'wales'], description: 'Tax region: rUK (England/NI), scotland, or wales' },
        nonSavingsIncome: { type: 'number', description: 'Gross employment or non-savings income in pence' },
        savingsIncome: { type: 'number', description: 'Savings interest income in pence' },
        dividendIncome: { type: 'number', description: 'Dividend income in pence' },
        giftAidGrossedUp: { type: 'number', description: 'Grossed-up Gift Aid payments in pence' },
        relievablePensionContributions: { type: 'number', description: 'Relievable pension contributions in pence' },
        blindPersonsAllowanceClaimed: { type: 'boolean', description: 'Whether Blind Person\'s Allowance is claimed' },
      },
      required: ['taxYear', 'region', 'nonSavingsIncome', 'savingsIncome', 'dividendIncome'],
    },
  },
  {
    name: 'compute_full_return',
    description: 'Runs the top-level HMRC calculation assembler on a complete Return object, returning full income tax, CGT, charges, and balancing payments.',
    inputSchema: {
      type: 'object',
      properties: {
        taxYear: { type: 'string', description: 'Tax year, e.g. "2025-26"' },
        returnObj: { type: 'object', description: 'The complete Return object' },
      },
      required: ['taxYear', 'returnObj'],
    },
  },
];

// 3. Register Tool Listing Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// 4. Register Tool Call Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const { taxYear } = args as { taxYear: string };
    const config = getConfig(taxYear);

    if (name === 'compute_income_tax') {
      const {
        region,
        nonSavingsIncome,
        savingsIncome,
        dividendIncome,
        giftAidGrossedUp = 0,
        relievablePensionContributions = 0,
        blindPersonsAllowanceClaimed = false,
      } = args as unknown as ComputeIncomeTaxInput;

      const result = computeIncomeTax(
        {
          region,
          nonSavingsIncome,
          savingsIncome,
          dividendIncome,
          giftAidGrossedUp,
          relievablePensionContributions,
          blindPersonsAllowanceClaimed,
        },
        config
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              calculation: result,
              version: {
                taxYear,
                methodologyVersion: 'HMRC-v1',
                engineVersion: '1.1.0',
                configHash: configHash(config),
              },
            }, null, 2),
          },
        ],
      };
    }

    if (name === 'compute_full_return') {
      const { returnObj } = args as { returnObj: Return };
      const result = computeFullReturn(returnObj, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              calculation: result,
              version: {
                taxYear,
                methodologyVersion: 'HMRC-v1',
                engineVersion: '1.1.0',
                configHash: configHash(config),
              },
            }, null, 2),
          },
        ],
      };
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            message: error.message || 'Unknown calculation error',
          }),
        },
      ],
      isError: true,
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

// 5. Start Server over Standard Input/Output (Stdio) Transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UK Tax Calculation MCP server running on stdio');
}

run().catch((error) => {
  console.error('Fatal error running MCP server:', error);
  process.exit(1);
});
