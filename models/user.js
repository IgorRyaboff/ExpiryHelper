
const sequelize = require('sequelize');
const dataTypes = sequelize.DataTypes;

/**
 * 
 * @param {sequelize.Sequelize} sequelizeInstance 
 */
function init(sequelizeInstance) {
    sequelizeInstance.define('User', {
        id: {
            type: dataTypes.BIGINT,
            primaryKey: true,
        },
        family: dataTypes.BIGINT,
        currentAction: {
            type: dataTypes.STRING(1024),
            defaultValue: JSON.stringify(null),
            allowNull: false,
            get() {
                let raw = this.getDataValue('currentAction');
                return JSON.parse(raw);
            },
            set(value) {
                this.setDataValue('currentAction', JSON.stringify(value));
            },
        }
    });
}

module.exports = init;
