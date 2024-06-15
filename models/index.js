
const sequelize = require('sequelize');

/**
 * 
 * @param {sequelize.Sequelize} sequelizeInstance 
 */
function init(sequelizeInstance) {
    require('./user')(sequelizeInstance);
    require('./product')(sequelizeInstance);
    require('./invite')(sequelizeInstance);
}

module.exports = init;
