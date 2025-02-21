export const retrieveEnvVariable = (variableName: string) => {
    const variable = process.env[variableName] || '';
    if (!variable) {
      throw new Error(`Environment variable "${variableName}" is not set`);
    }
    return variable;
  };