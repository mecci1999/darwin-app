module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^typings$': '<rootDir>/src/typings',
    '^db/(.*)$': '<rootDir>/src/db/$1',
    '^utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
