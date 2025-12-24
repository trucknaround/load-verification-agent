/**
 * Load Verification Agent - Test Suite
 */

import { verifyLoad, LoadVerificationInput } from '../services/verificationService';

// Base test load
const BASE_LOAD: LoadVerificationInput = {
  load_id: 'test-load-001',
  broker_name: 'Test Logistics',
  broker_mc: '123456',
  credit_score: 85,
  posted_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  pickup_city: 'Chicago, IL',
  delivery_city: 'Atlanta, GA',
  rate: 2400,
  equipment: 'Dry Van',
};

// Test cases
interface TestCase {
  name: string;
  load: LoadVerificationInput;
  expectedStatus: 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';
  description: string;
}

const testCases: TestCase[] = [
  {
    name: 'PERFECT_LOAD',
    load: {
      ...BASE_LOAD,
      credit_score: 85,
      posted_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    expectedStatus: 'APPROVED',
    description: 'Perfect load: good credit score, fresh, valid MC',
  },
  {
    name: 'LOW_CREDIT_SCORE',
    load: {
      ...BASE_LOAD,
      credit_score: 81,
    },
    expectedStatus: 'REJECTED',
    description: 'Credit score below minimum (81 < 82)',
  },
  {
    name: 'VERY_LOW_CREDIT',
    load: {
      ...BASE_LOAD,
      credit_score: 50,
    },
    expectedStatus: 'REJECTED',
    description: 'Very low credit score (50)',
  },
  {
    name: 'STALE_LOAD',
    load: {
      ...BASE_LOAD,
      posted_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    },
    expectedStatus: 'REJECTED',
    description: 'Load too old (90 minutes > 60 minute threshold)',
  },
  {
    name: 'SUSPICIOUS_HIGH_CREDIT',
    load: {
      ...BASE_LOAD,
      credit_score: 98,
    },
    expectedStatus: 'NEEDS_REVIEW',
    description: 'Suspiciously high credit score (98 > 97)',
  },
  {
    name: 'SOMEWHAT_STALE',
    load: {
      ...BASE_LOAD,
      credit_score: 85,
      posted_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
    expectedStatus: 'NEEDS_REVIEW',
    description: 'Load somewhat stale (45 minutes)',
  },
];

// Test runner
async function runTests() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║       🧪 Load Verification Agent - Test Suite                 ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const testCase of testCases) {
    try {
      const result = await verifyLoad(testCase.load);
      
      if (result.verification_status === testCase.expectedStatus) {
        passed++;
        console.log(`✅ ${testCase.name}`);
        console.log(`   ${testCase.description}`);
        console.log(`   Expected: ${testCase.expectedStatus} | Got: ${result.verification_status}`);
        if (result.reasons.length > 0) {
          console.log(`   Reasons: ${result.reasons.join(', ')}`);
        }
      } else {
        failed++;
        const failureMsg = `❌ ${testCase.name}: Expected ${testCase.expectedStatus}, got ${result.verification_status}`;
        failures.push(failureMsg);
        console.log(failureMsg);
        console.log(`   ${testCase.description}`);
        console.log(`   Reasons: ${result.reasons.join(', ')}`);
      }
      
      console.log('');
    } catch (error) {
      failed++;
      const errorMsg = `❌ ${testCase.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      failures.push(errorMsg);
      console.log(errorMsg);
      console.log('');
    }
  }

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                      TEST SUMMARY                              ║
╠════════════════════════════════════════════════════════════════╣
║  Total Tests:  ${testCases.length.toString().padEnd(47)}║
║  Passed:       ${passed.toString().padEnd(47)}║
║  Failed:       ${failed.toString().padEnd(47)}║
╚════════════════════════════════════════════════════════════════╝
  `);

  if (failures.length > 0) {
    console.log('\n🔴 FAILURES:\n');
    failures.forEach(f => console.log(f));
    console.log('');
  }

  if (failed === 0) {
    console.log('🎉 All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review.\n');
    process.exit(1);
  }
}

// Load environment variables
require('dotenv').config();

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
