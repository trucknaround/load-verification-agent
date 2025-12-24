/**
 * Load Verification Service
 * Core verification logic for Pure Dispatch
 */

import axios from 'axios';

// Types
export interface LoadVerificationInput {
  load_id: string;
  broker_name: string;
  broker_mc: string;
  credit_score: number;
  posted_at: string;
  pickup_city: string;
  delivery_city: string;
  rate: number;
  equipment: string;
}

export interface VerificationResult {
  verification_status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';
  reasons: string[];
  verified_at: string;
  metadata?: any;
}

interface FMCSACarrier {
  mc_number: string;
  legal_name: string;
  status: string;
  allowed_to_operate: boolean;
  out_of_service: boolean;
  carrier_operation: string;
}

// Configuration
const CONFIG = {
  CREDIT_SCORE_MIN: 82,
  CREDIT_SCORE_MAX: 97,
  LOAD_FRESHNESS_WARNING_MINUTES: 30,
  LOAD_FRESHNESS_REJECT_MINUTES: 60,
  FMCSA_API_BASE: 'https://mobile.fmcsa.dot.gov/qc/services/carriers',
  FMCSA_TIMEOUT_MS: 5000,
};

// Main verification function
export async function verifyLoad(load: LoadVerificationInput): Promise<VerificationResult> {
  const reasons: string[] = [];
  const metadata: any = {};

  try {
    // 1. Credit Score Check
    const creditCheck = verifyCreditScore(load.credit_score);
    metadata.credit_score_check = creditCheck.status;
    
    if (creditCheck.reject) {
      return reject(creditCheck.reason, metadata);
    }
    
    if (creditCheck.warning) {
      reasons.push(creditCheck.warning);
    }

    // 2. FMCSA MC Number Validation
    const fmcsaCheck = await verifyFMCSA(load.broker_mc);
    metadata.fmcsa_status = fmcsaCheck.status;
    
    if (fmcsaCheck.carrier) {
      metadata.carrier_info = fmcsaCheck.carrier;
    }
    
    if (fmcsaCheck.reject) {
      return reject(fmcsaCheck.reason, metadata);
    }
    
    if (fmcsaCheck.warning) {
      reasons.push(fmcsaCheck.warning);
    }

    // 3. Load Freshness Check
    const freshnessCheck = verifyLoadFreshness(load.posted_at);
    metadata.load_age_minutes = freshnessCheck.ageMinutes;
    
    if (freshnessCheck.reject) {
      return reject(freshnessCheck.reason, metadata);
    }
    
    if (freshnessCheck.warning) {
      reasons.push(freshnessCheck.warning);
    }

    // Final Decision
    if (reasons.length > 0) {
      return needsReview(reasons, metadata);
    }

    return approve(metadata);

  } catch (error) {
    console.error('Verification error:', error);
    return needsReview(
      [`Verification system error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      metadata
    );
  }
}

// Credit score verification
function verifyCreditScore(score: number): {
  status: string;
  reject?: boolean;
  warning?: string;
  reason?: string;
} {
  if (score < CONFIG.CREDIT_SCORE_MIN) {
    return {
      status: 'FAILED',
      reject: true,
      reason: `Credit score ${score} below minimum threshold (${CONFIG.CREDIT_SCORE_MIN})`,
    };
  }

  if (score > CONFIG.CREDIT_SCORE_MAX) {
    return {
      status: 'SUSPICIOUS',
      warning: `Credit score ${score} unusually high - may indicate fake/manipulated score`,
    };
  }

  return { status: 'PASSED' };
}

// Load freshness verification
function verifyLoadFreshness(postedAt: string): {
  ageMinutes: number;
  reject?: boolean;
  warning?: string;
  reason?: string;
} {
  const postedTime = new Date(postedAt).getTime();
  const now = Date.now();
  const ageMinutes = Math.floor((now - postedTime) / 1000 / 60);

  if (ageMinutes > CONFIG.LOAD_FRESHNESS_REJECT_MINUTES) {
    return {
      ageMinutes,
      reject: true,
      reason: `Load posted ${ageMinutes} minutes ago - likely unavailable (>${CONFIG.LOAD_FRESHNESS_REJECT_MINUTES}min threshold)`,
    };
  }

  if (ageMinutes > CONFIG.LOAD_FRESHNESS_WARNING_MINUTES) {
    return {
      ageMinutes,
      warning: `Load posted ${ageMinutes} minutes ago - may be stale`,
    };
  }

  return { ageMinutes };
}

// FMCSA API verification
async function verifyFMCSA(mcNumber: string): Promise<{
  status: string;
  carrier?: FMCSACarrier;
  reject?: boolean;
  warning?: string;
  reason?: string;
}> {
  const apiKey = process.env.FMCSA_API_KEY;

  if (!apiKey) {
    console.warn('FMCSA_API_KEY not configured - skipping FMCSA check');
    return {
      status: 'SKIPPED',
      warning: 'FMCSA validation unavailable (API key not configured)',
    };
  }

  try {
   const url = `${CONFIG.FMCSA_API_BASE}/${mcNumber}?webKey=${apiKey!}`;
    
    const response = await axios.get(url, {
      timeout: CONFIG.FMCSA_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' },
    });

    const data = response.data;
    
    if (!data || !data.content) {
      return {
        status: 'NOT_FOUND',
        reject: true,
        reason: `MC number ${mcNumber} not found in FMCSA database`,
      };
    }

    const carrier = data.content.carrier;
    
    if (!carrier) {
      return {
        status: 'NOT_FOUND',
        reject: true,
        reason: `MC number ${mcNumber} has no carrier data`,
      };
    }

    const carrierInfo: FMCSACarrier = {
      mc_number: mcNumber,
      legal_name: carrier.legalName || 'Unknown',
      status: carrier.allowedToOperate || 'UNKNOWN',
      allowed_to_operate: carrier.allowedToOperate === 'Y',
      out_of_service: carrier.outOfServiceDate !== null,
      carrier_operation: carrier.carrierOperation || 'Unknown',
    };

    if (!carrierInfo.allowed_to_operate) {
      return {
        status: 'NOT_AUTHORIZED',
        carrier: carrierInfo,
        reject: true,
        reason: `Carrier ${mcNumber} (${carrierInfo.legal_name}) not authorized to operate`,
      };
    }

    if (carrierInfo.out_of_service) {
      return {
        status: 'OUT_OF_SERVICE',
        carrier: carrierInfo,
        reject: true,
        reason: `Carrier ${mcNumber} (${carrierInfo.legal_name}) is out of service`,
      };
    }

    return {
      status: 'ACTIVE',
      carrier: carrierInfo,
    };

  } catch (error) {
    console.error('FMCSA API error:', error);
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return {
          status: 'TIMEOUT',
          warning: 'FMCSA API timeout - broker verification incomplete',
        };
      }
      
      if (error.response?.status === 404) {
        return {
          status: 'NOT_FOUND',
          reject: true,
          reason: `MC number ${mcNumber} not found in FMCSA database`,
        };
      }
    }

    return {
      status: 'ERROR',
      warning: `FMCSA API error - broker verification incomplete`,
    };
  }
}

// Decision builders
function approve(metadata?: any): VerificationResult {
  return {
    verification_status: 'APPROVED',
    reasons: [],
    verified_at: new Date().toISOString(),
    metadata,
  };
}

function reject(reason: string, metadata?: any): VerificationResult {
  return {
    verification_status: 'REJECTED',
    reasons: [reason],
    verified_at: new Date().toISOString(),
    metadata,
  };
}

function needsReview(reasons: string[], metadata?: any): VerificationResult {
  return {
    verification_status: 'NEEDS_REVIEW',
    reasons,
    verified_at: new Date().toISOString(),
    metadata,
  };
}
