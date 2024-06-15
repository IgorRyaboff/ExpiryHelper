
const sequelize = require('sequelize');
const dataTypes = sequelize.DataTypes;

/**
 * 
 * @param {sequelize.Sequelize} sequelizeInstance 
 */
function init(sequelizeInstance) {
    sequelizeInstance.define('Product', {
        code: {
            type: dataTypes.INTEGER,
            primaryKey: true,
        },
        family: {
            type: dataTypes.BIGINT,
            primaryKey: true,
        },
        name: {
            type: dataTypes.STRING(100),
            allowNull: false,
        },
        expires: {
            type: dataTypes.DATE,
            allowNull: false,
        },
        withdrawn: dataTypes.DATE,
    });
}

module.exports = init;
