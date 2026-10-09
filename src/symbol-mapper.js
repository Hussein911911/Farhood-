const SYMBOL_PATTERN = /^[A-Za-z0-9._#-]{1,32}$/;

export class SymbolMapper {
  constructor(spec = '') {
    this.mapping = new Map();
    for (const entry of spec.split(',').map((item) => item.trim()).filter(Boolean)) {
      const separator = entry.indexOf(':');
      if (separator < 1 || separator === entry.length - 1) {
        throw new Error(`Invalid SYMBOL_MAP entry "${entry}"; expected TradingViewSymbol:BrokerSymbol`);
      }
      const source = entry.slice(0, separator).trim();
      const target = entry.slice(separator + 1).trim();
      if (!SYMBOL_PATTERN.test(source) || !SYMBOL_PATTERN.test(target)) {
        throw new Error(`Invalid symbol in SYMBOL_MAP entry "${entry}"`);
      }
      this.mapping.set(source.toUpperCase(), target);
    }
  }

  map(symbol) {
    return this.mapping.get(symbol.toUpperCase()) ?? symbol;
  }
}
