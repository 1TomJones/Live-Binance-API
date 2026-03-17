const MAX_FILE_SIZE_BYTES = 1024 * 1024;

export class StrategyValidationService {
  validateUpload({ fileName, content }) {
    if (!fileName || !content) {
      return { valid: false, errors: ['Strategy file name and content are required.'] };
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE_BYTES) {
      return { valid: false, errors: ['Strategy file exceeds 1 MB limit for this workspace shell.'] };
    }

    const extension = fileName.split('.').at(-1)?.toLowerCase();
    const allowed = ['json', 'yaml', 'yml', 'toml'];
    if (!allowed.includes(extension)) {
      return { valid: false, errors: [`Unsupported strategy file extension: .${extension || 'unknown'}`] };
    }

    return { valid: true, errors: [] };
  }
}

export class StrategyParserService {
  parse(content) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        parsed: false,
        metadata: {},
        parseMessage: 'Framework accepted file but could not parse structured metadata. Use JSON to preview summary fields.'
      };
    }

    const metadata = {
      strategyName: parsed.strategyName || parsed.name || 'Unnamed Strategy',
      description: parsed.description || '',
      symbol: parsed.symbol || 'BTCUSDT',
      timeframe: parsed.timeframe || '1m',
      version: parsed.version || '0.0.0',
      author: parsed.author || 'Unknown',
      notes: parsed.notes || '',
      riskSettings: parsed.riskSettings || {},
      executionModes: parsed.executionModes || ['historical_backtest'],
      placeholderConfig: parsed.placeholderConfig || {}
    };

    return {
      parsed: true,
      metadata,
      parseMessage: 'Metadata parsed using placeholder parser adapter. Strategy rule execution wiring is deferred to the dedicated engine module.'
    };
  }
}

export class StrategyUploadService {
  constructor({ validationService, parserService, saveStrategyRecord }) {
    this.validationService = validationService;
    this.parserService = parserService;
    this.saveStrategyRecord = saveStrategyRecord;
  }

  handleUpload(payload) {
    const validation = this.validationService.validateUpload(payload);
    if (!validation.valid) {
      return { status: 'invalid', validation, strategy: null };
    }

    const parseResult = this.parserService.parse(payload.content);
    const strategy = this.saveStrategyRecord({
      file_name: payload.fileName,
      raw_content: payload.content,
      parse_status: parseResult.parsed ? 'parsed' : 'uploaded',
      metadata_json: JSON.stringify(parseResult.metadata || {}),
      parse_message: parseResult.parseMessage
    });

    return {
      status: parseResult.parsed ? 'parsed' : 'uploaded',
      validation,
      parseResult,
      strategy
    };
  }
}
