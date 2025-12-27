/**
 * Load Verification Agent API Server
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { verifyLoad, LoadVerificationInput, VerificationResult } from './services/verificationService';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['POST', 'GET'],
  credentials: true,
}));

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Authentication middleware - FIXED
function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const receivedKey = req.headers['x-api-key'] as string;
  const expectedKey = process.env.API_KEY;

  // Debug logging
  console.log('Auth Check:');
  console.log('- Received key:', receivedKey ? `${receivedKey.substring(0, 10)}...` : 'MISSING');
  console.log('- Expected key:', expectedKey ? `${expectedKey.substring(0, 10)}...` : 'NOT SET');
  console.log('- Keys match:', receivedKey === expectedKey);

  if (!expectedKey) {
    console.error('ERROR: API_KEY environment variable is not set!');
    return res.status(500).json({
      error: 'Configuration error',
      message: 'API key not configured on server',
    });
  }

  if (!receivedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing X-API-Key header',
    });
  }

  // Trim whitespace and compare
  const cleanReceivedKey = receivedKey.trim();
  const cleanExpectedKey = expectedKey.trim();

  if (cleanReceivedKey !== cleanExpectedKey) {
    console.error('Key mismatch!');
    console.error('Received length:', cleanReceivedKey.length);
    console.error('Expected length:', cleanExpectedKey.length);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  next();
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'load-verification-agent',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    api_key_configured: !!process.env.API_KEY,
  });
});

// Debug endpoint - REMOVE THIS AFTER FIXING
app.get('/debug/env', (req: Request, res: Response) => {
  res.json({
    API_KEY_SET: !!process.env.API_KEY,
    API_KEY_LENGTH: process.env.API_KEY?.length || 0,
    API_KEY_FIRST_10: process.env.API_KEY?.substring(0, 10) || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    FMCSA_KEY_SET: !!process.env.FMCSA_API_KEY,
  });
});

// Main verification endpoint
app.post('/api/verify', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const load: LoadVerificationInput = req.body;

    const validationError = validateLoadInput(load);
    if (validationError) {
      return res.status(400).json({
        error: 'Invalid input',
        message: validationError,
      });
    }

    console.log(`[VERIFY] Processing load ${load.load_id} from ${load.broker_name} (MC: ${load.broker_mc})`);

    const result: VerificationResult = await verifyLoad(load);

    console.log(`[VERIFY] Result: ${result.verification_status} - ${result.reasons.length} reasons`);

    res.json(result);

  } catch (error) {
    console.error('[VERIFY] Error:', error);
    
    res.status(500).json({
      error: 'Verification failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Batch verification endpoint
app.post('/api/verify/batch', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const loads: LoadVerificationInput[] = req.body.loads;

    if (!Array.isArray(loads)) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must contain "loads" array',
      });
    }

    if (loads.length > 50) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Maximum 50 loads per batch request',
      });
    }

    console.log(`[VERIFY BATCH] Processing ${loads.length} loads`);

    const results = await Promise.all(
      loads.map(async (load) => {
        try {
          const result = await verifyLoad(load);
          return {
            load_id: load.load_id,
            ...result,
          };
        } catch (error) {
          return {
            load_id: load.load_id,
            verification_status: 'NEEDS_REVIEW' as const,
            reasons: [`Verification error: ${error instanceof Error ? error.message : 'Unknown'}`],
            verified_at: new Date().toISOString(),
          };
        }
      })
    );

    console.log(`[VERIFY BATCH] Completed: ${results.length} results`);

    res.json({
      total: results.length,
      approved: results.filter(r => r.verification_status === 'APPROVED').length,
      rejected: results.filter(r => r.verification_status === 'REJECTED').length,
      needs_review: results.filter(r => r.verification_status === 'NEEDS_REVIEW').length,
      results,
    });

  } catch (error) {
    console.error('[VERIFY BATCH] Error:', error);
    
    res.status(500).json({
      error: 'Batch verification failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Input validation
function validateLoadInput(load: LoadVerificationInput): string | null {
  if (!load.load_id) return 'load_id is required';
  if (!load.broker_name) return 'broker_name is required';
  if (!load.broker_mc) return 'broker_mc is required';
  if (typeof load.credit_score !== 'number') return 'credit_score must be a number';
  if (!load.posted_at) return 'posted_at is required';
  
  if (isNaN(Date.parse(load.posted_at))) {
    return 'posted_at must be valid ISO 8601 timestamp';
  }

  if (load.credit_score < 0 || load.credit_score > 100) {
    return 'credit_score must be between 0 and 100';
  }

  return null;
}

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║         🔍 Load Verification Agent API Server                 ║
║                                                                ║
║  Status:     RUNNING                                           ║
║  Port:       ${PORT}                                              ║
║  Env:        ${process.env.NODE_ENV || 'development'}                                   ║
║  API Key:    ${process.env.API_KEY ? 'SET' : 'NOT SET'}                                     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  });
}

export default app;
