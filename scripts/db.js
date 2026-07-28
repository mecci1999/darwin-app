const path = require('path');
const dotenv = require('dotenv');
const { Sequelize } = require('sequelize');

const projectRoot = path.resolve(__dirname, '..');
const environmentFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';

dotenv.config({ path: path.join(projectRoot, environmentFile), override: false });
dotenv.config({ path: path.join(projectRoot, '.env'), override: false });

const requiredVariables = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];

const createDatabaseConnection = () => {
  const missing = requiredVariables.filter(variable => !process.env[variable]);
  if (missing.length > 0) {
    throw new Error(`Missing required MySQL environment variables: ${missing.join(', ')}`);
  }

  return new Sequelize(process.env.MYSQL_DATABASE, process.env.MYSQL_USER, process.env.MYSQL_PASSWORD, {
    dialect: 'mysql',
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    logging: false,
    timezone: '+08:00',
  });
};

module.exports = { createDatabaseConnection };
