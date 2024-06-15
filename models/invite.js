
const sequelize = require('sequelize');
const dataTypes = sequelize.DataTypes;

/**
 * 
 * @param {sequelize.Sequelize} sequelizeInstance 
 */
function init(sequelizeInstance) {
    sequelizeInstance.define('Invite', {
        code: {
            type: dataTypes.INTEGER,
            primaryKey: true,
        },
        family: {
            type: dataTypes.BIGINT,
            allowNull: false,
        },
        expires: {
            type: dataTypes.DATE,
            allowNull: false,
        }
    });
}

module.exports = init;
