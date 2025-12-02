import type { Config } from "jest";

const cfg: Config = {
  transform: {
    "^.+\\.[jt]s$": ["@swc/jest", {}],
  },
  transformIgnorePatterns: [],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  coveragePathIgnorePatterns: ["node_modules", "mocks"],
  collectCoverage: true,
  coverageReporters: ["json", "lcov", "text", "clover", "json-summary"],
  reporters: ["default", "jest-junit", "jest-md-dashboard"],
  coverageDirectory: "coverage",
  testTimeout: 20000,
  roots: ["<rootDir>", "tests"],
  setupFilesAfterEnv: ["dotenv/config"],
};

export default cfg;
