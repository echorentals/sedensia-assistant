import { getEstimates } from './client.js';
import { recordPricingHistory, findSignTypeByName, findMaterialByName } from '../../db/index.js';

interface ParsedLineItem {
  signType: string | null;
  material: string | null;
  width: number;
  height: number;
  description: string;
}

function parseDescription(description: string): ParsedLineItem {
  // Try to extract sign type from description
  const signTypes = [
    'Channel Letters', 'Monument Sign', 'Pylon Sign', 'Wall Sign',
    'Wayfinding Sign', 'ADA Sign', 'Vinyl Graphics', 'Vehicle Wrap',
    'Banner', 'A-Frame', 'Dimensional Letters', 'Cabinet Sign',
  ];

  const materials = [
    'Aluminum', 'Acrylic', 'Dibond', 'PVC', 'Coroplast',
    'HDU', 'Stainless Steel', 'Bronze', 'LED', 'Neon',
  ];

  let foundSignType: string | null = null;
  let foundMaterial: string | null = null;

  for (const st of signTypes) {
    if (description.toLowerCase().includes(st.toLowerCase())) {
      foundSignType = st;
      break;
    }
  }

  for (const mat of materials) {
    if (description.toLowerCase().includes(mat.toLowerCase())) {
      foundMaterial = mat;
      break;
    }
  }

  // Try to parse dimensions
  const dimMatch = description.match(/(\d+(?:\.\d+)?)\s*['"x×]\s*(\d+(?:\.\d+)?)/i);
  let width = 24; // default
  let height = 24; // default

  if (dimMatch) {
    width = parseFloat(dimMatch[1]);
    height = parseFloat(dimMatch[2]);
    // Convert feet to inches if small numbers
    if (width <= 10 && height <= 10) {
      width *= 12;
      height *= 12;
    }
  }

  return {
    signType: foundSignType,
    material: foundMaterial,
    width,
    height,
    description,
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export async function importHistoricalEstimates(): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: 0 };

  try {
    const estimates = await getEstimates(500); // Get up to 500 estimates
    console.log(`Found ${estimates.length} estimates to import`);

    for (const estimate of estimates) {
      for (const line of estimate.Line) {
        if (line.DetailType !== 'SalesItemLineDetail') continue;
        if (!line.Description) {
          result.skipped++;
          continue;
        }

        const parsed = parseDescription(line.Description);

        // Look up sign type and material IDs
        const signType = parsed.signType ? await findSignTypeByName(parsed.signType) : null;
        const material = parsed.material ? await findMaterialByName(parsed.material) : null;

        try {
          await recordPricingHistory({
            signTypeId: signType?.id,
            materialId: material?.id,
            description: parsed.description,
            widthInches: parsed.width,
            heightInches: parsed.height,
            quantity: line.SalesItemLineDetail?.Qty || 1,
            unitPrice: line.SalesItemLineDetail?.UnitPrice || line.Amount,
            totalPrice: line.Amount,
            outcome: 'pending', // We don't know from estimates alone
            quickbooksEstimateId: estimate.Id,
          });
          result.imported++;
        } catch (error) {
          console.error('Failed to import line item:', error);
          result.errors++;
        }
      }
    }

    console.log(`Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
    return result;
  } catch (error) {
    console.error('Failed to import historical estimates:', error);
    throw error;
  }
}
