
const telegraf = require('telegraf');
const sequelize = require('sequelize');
const moment = require('moment');
const crypto = require("crypto");
const cron = require('cron');

const securityToken = crypto.randomInt(1000000000, 9999999999);
console.log('Security token for current session is ' + securityToken);

/** @type {sequelize.Sequelize} */
let db;

/** @type {telegraf.Telegraf} */
let bot = new telegraf.Telegraf(require('./etc/telegraf.json').token);

async function init() {
    db = new sequelize.Sequelize(require('./etc/sequelize.json'));

    await db.authenticate();
    console.log('Database connection OK');

    require('./models/index')(db);
    await db.sync({ alter: true });
    console.log('Database synced');

    bot.launch();
}
init();

bot.use(async (ctx, next) => {
    let transaction = await db.transaction();
    ctx.transaction = transaction;

    let user = await db.models.User.findByPk(ctx.from.id, { transaction, lock: true });
    if (!user) {
        user = db.models.User.build({
            id: ctx.from.id,
            family: ctx.from.id,
        });
        await user.save({ transaction });
    }
    ctx.dbUser = user;

    next();
});

bot.command('new', async ctx => {
    let expiredCount = await db.models.Product.count({
        where: { family: ctx.dbUser.family, withdrawn: null, expires: { [sequelize.Op.lt]: new Date } },
        transaction: ctx.transaction,
    });
    if (expiredCount > 0) {
        await ctx.reply('🛑 Есть неудаленные просроченные продукты (/listexpired)');
        await ctx.transaction.commit();
        return;
    }

    ctx.dbUser.currentAction = { action: 'new.requestName' };
    await ctx.dbUser.save({ transaction: ctx.transaction });

    await ctx.reply('Введите наименование продукта (например, <i>молоко</i>)', { parse_mode: 'HTML' });
    await ctx.transaction.commit();
});

bot.command('list', async ctx => {
    await processListCommand(ctx, {}, 'Список продуктов (просроченные <u>подчеркнуты</u>):', 'Нет активных продуктов');
    await ctx.transaction.commit();
});

bot.command('listexpired', async ctx => {
    await processListCommand(ctx, { expires: { [sequelize.Op.lt]: new Date } }, 'Список просроченных продуктов:', 'Нет просроченных продуктов');
    await ctx.transaction.commit();
});

async function processListCommand(ctx, additionalWhereConditions = {}, title, noProductsMessage) {
    let whereStatement = { family: ctx.dbUser.family, withdrawn: null, ...additionalWhereConditions };
    let list = await db.models.Product.findAll({
        where: whereStatement,
        transaction: ctx.transaction,
        order: [['expires', 'ASC']],
    });

    if (list.length == 0) {
        ctx.reply(noProductsMessage);
        await ctx.transaction.commit();
        return;
    }

    let texts = list.map(product => {
        let result = `<b>№${product.code}</b> ${product.name} (до ${moment(product.expires).format('DD.MM.YY')})`;
        if (product.expires < new Date) result = `<u>${result}</u>`;
        if (product.expires < new Date) result = `<u>${result}</u>`;
        return result;
    });
    ctx.reply(title + '\n\n' + texts.join('\n'), { parse_mode: 'HTML', });
}

bot.command('inventory', async ctx => {
    ctx.dbUser.currentAction = { action: 'inventory' };
    await ctx.dbUser.save({ transaction: ctx.transaction });

    await ctx.reply('Введите в следующем сообщением коды всех продуктов, которые фактически найдены у вас дома. Одна строка - один код', { parse_mode: 'HTML' });
    await ctx.transaction.commit();
});

bot.command('notificationcron', async ctx => {
    let givenSecurityToken = +ctx.message.text.replace('/notificationcron ', '');
    if (givenSecurityToken == securityToken) {
        await notifyAboutExpiredProducts();
        await ctx.reply('OK');
    }
    await ctx.transaction.commit();
});

bot.command('cleanupcron', async ctx => {
    let givenSecurityToken = +ctx.message.text.replace('/cleanupcron ', '');
    if (givenSecurityToken == securityToken) {
        await cleanupWithdrawnProducts();
        await ctx.reply('OK');
    }
    await ctx.transaction.commit();
});

bot.command('invite', async ctx => {
    await db.models.Invite.findAll({
        limit: 1,
        lock: true,
        transaction: ctx.transaction,
    });

    let code = undefined;
    while (!code || (await db.models.Invite.findByPk(code, { transaction: ctx.transaction, }))) {
        code = crypto.randomInt(100000, 1000000);
    }

    let invite = db.models.Invite.build({
        code: code,
        family: ctx.dbUser.family,
        expires: new Date(+new Date + 1000 * 3600),
    });
    await invite.save({ transaction: ctx.transaction, });
    await ctx.transaction.commit();
    ctx.reply(`Новый код приглашения: <b>${code}</b>`, { parse_mode: 'HTML' });
});

bot.command('acceptinvite', async ctx => {
    ctx.dbUser.currentAction = { action: 'acceptinvite' };
    await ctx.dbUser.save({ transaction: ctx.transaction, });
    await ctx.transaction.commit();
    ctx.reply('Введите код приглашения. Для отмены используйте /cancel');
});

bot.command('cancel', async ctx => {
    ctx.dbUser.currentAction = null;
    await ctx.dbUser.save({ transaction: ctx.transaction });

    await ctx.reply('Текущее действие отменено');
    await ctx.transaction.commit();
});

bot.hears(/.+/, async ctx => {
    if (ctx.dbUser.currentAction?.action == 'new.requestName') {
        ctx.dbUser.currentAction = {
            action: 'new.requestDate',
            name: ctx.message.text,
        };
        await ctx.reply('Укажите срок годности (например, 12, 12.06, 12.06.2024, 12.06.24). К сроку можно добавить количество дней (12.06 + 10 сут/мес/лет)');
        await ctx.dbUser.save({ transaction: ctx.transaction });
        await ctx.transaction.commit();
    }
    else if (ctx.dbUser.currentAction?.action == 'new.requestDate') {
        let textParts = ctx.message.text.split('+').map(x => x.trim());
        textParts = textParts.filter(x => (x.trim().length > 0));

        let momentDate = moment(textParts[0], 'DD', true);
        if (!momentDate.isValid()) {
            momentDate = moment(textParts[0], 'DD.MM', true);

            if (!momentDate.isValid()) {
                momentDate = moment(textParts[0], 'DD.MM.YY', true);

                if (!momentDate.isValid()) {
                    momentDate = moment(textParts[0], 'DD.MM.YYYY', true);

                    if (!momentDate.isValid()) {
                        await ctx.reply('Указана некорректная дата');
                        await ctx.transaction.commit();
                        return;
                    }
                }
            }
        }

        let date = momentDate.toDate();

        if (textParts.length == 2) {
            modifierParts = textParts[1].split(' ').filter(x => !!x.trim());
            count = +modifierParts[0];
            type = modifierParts[1];

            if (isNaN(count) || count < 0 || !Number.isInteger(count)) {
                await ctx.reply('Указан неверный модификатор даты');
                await ctx.transaction.commit();
                return;
            }

            modifierCoefficient = {
                'сут': 1,
                'мес': 30,
                'лет': 365
            }[type];
            if (!modifierCoefficient) {
                await ctx.reply('Указан неверный модификатор даты');
                await ctx.transaction.commit();
                return;
            }

            modifier = count * modifierCoefficient * 1000 * 86400;
            date = new Date(+date + modifier);
        }

        if (date < new Date) {
            await ctx.reply('Указана дата меньше текущей. Продукт не просрочен?');
            await ctx.transaction.commit();
            return;
        }

        await db.models.Product.findAll({
            where: { family: ctx.dbUser.family, },
            transaction: ctx.transaction,
            lock: true,
            limit: 1,
        });

        let productCode;
        while (!productCode || (await db.models.Product.count({
            where: { code: productCode, family: ctx.dbUser.family, },
            transaction: ctx.transaction,
        })) > 0) {
            productCode = crypto.randomInt(1000, 10000);
        }

        let product = db.models.Product.build({
            code: productCode,
            family: ctx.dbUser.family,
            name: ctx.dbUser.currentAction.name,
            expires: date,
        });
        await product.save({ transaction: ctx.transaction });
        
        ctx.dbUser.currentAction = null;
        await ctx.dbUser.save({ transaction: ctx.transaction });

        await ctx.transaction.commit();

        await ctx.reply(`Код нового продукта: <b>${productCode}</b>\nСрок годности: ${moment(date).format('DD.MM.YYYY')}`, {parse_mode: 'HTML'});
    }
    else if (ctx.dbUser.currentAction?.action == 'acceptinvite') {
        code = +ctx.message.text;
        if (isNaN(code)) {
            await ctx.transaction.commit();
            ctx.reply('Код приглашения указан неверно');
            return;
        }

        let invite = await db.models.Invite.findByPk(code, { transaction: ctx.transaction, lock: true, });
        if (!invite || invite.expires < new Date ) {
            await ctx.transaction.commit();
            ctx.reply('Код приглашения отсутствует или срок его действия истек');
            return;
        }

        if (invite.family == ctx.dbUser.family) {
            await ctx.transaction.commit();
            ctx.reply('Код приглашения относится к текущей "семье"');
            return;
        }

        let currentFamilyHasProducts = (await db.models.Product.count({ where: { family: ctx.dbUser.family, withdrawn: null } })) > 0;
        let currentFamilyHasOnlyCurrentUser = (await db.models.User.count({
            where: { family: ctx.dbUser.family, id: { [sequelize.Op.ne]: ctx.dbUser.id }, },
            transaction: ctx.transaction,
        })) > 0;

        if (currentFamilyHasOnlyCurrentUser && currentFamilyHasProducts) {
            await ctx.transaction.commit();
            ctx.reply('У вас сейчас есть активные продукты. Переключение на другую "семью" невозможно');
            return;
        }
        
        ctx.dbUser.family = invite.family;
        ctx.dbUser.currentAction = null;
        await ctx.dbUser.save({ transaction: ctx.transaction, });

        await invite.destroy({ transaction: ctx.transaction, });

        await ctx.transaction.commit();
        ctx.reply('Вы успешно переключились на другую "семью"');
    }
    else if (ctx.dbUser.currentAction?.action == 'inventory') {
        let codes = ctx.message.text.split('\n');
        const title = 'Пропущенные продукты:';
        const noProductsMessage = 'Не было пропущено ни одного продукта, ура!';
        processListCommand(ctx, { code: { [sequelize.Op.notIn]: codes } }, title, noProductsMessage);

        ctx.dbUser.currentAction = null;
        await ctx.dbUser.save({ transaction: ctx.transaction, });
        await ctx.transaction.commit();
    }
    else {
        let productCode = +ctx.message.text;
        if (!isNaN(productCode) && Number.isInteger(productCode) && productCode >= 1000 && productCode <= 99999999) {
            let product = await db.models.Product.findOne({
                where: { code: productCode, family: ctx.dbUser.family, },
                transaction: ctx.transaction,
                lock: true,
            });

            if (!product) {
                ctx.reply('Продукт с указанным кодом не найден');
                await ctx.transaction.commit();
                return;
            }

            if (product.withdrawn) {
                ctx.reply('Продукт с указанным кодом уже удален');
                await ctx.transaction.commit();
                return;
            }

            let keyboard = telegraf.Markup.inlineKeyboard([
                [
                    { text: 'Удалить', callback_data: 'withdraw_' + productCode }
                ]
            ]).oneTime();
            await ctx.reply(`Продукт: <b>${productCode}</b>\n${product.name}\nСрок годности: ${moment(product.expires).format('DD.MM.YYYY')}`, {
                parse_mode: 'HTML',
                ...keyboard
            });
            await ctx.transaction.commit();
        }
        else {
            await ctx.transaction.commit();
        }
    }
});

bot.action(/withdraw_[0-9]{4,}/, async ctx => {
    let productCode = +ctx.callbackQuery.data.split('_')[1];
    let product = await db.models.Product.findOne({
        where: { code: productCode, family: ctx.dbUser.family, },
        transaction: ctx.transaction,
        lock: true,
    });
    
    await ctx.answerCbQuery();

    if (!product) {
        ctx.reply('Продукт с указанным кодом не найден');
        await ctx.transaction.commit();
        return;
    }

    if (product.withdrawn) {
        ctx.reply('Продукт с указанным кодом уже удален');
        await ctx.transaction.commit();
        return;
    }

    product.withdrawn = new Date;
    await product.save({ transaction: ctx.transaction, });
    await ctx.transaction.commit();
    ctx.reply('Продукт удален, спасибо :)');
});

bot.use(ctx => {
    if (!ctx.transaction.finished) ctx.transaction.commit();
});

async function notifyAboutExpiredProducts() {
    let products = await db.models.Product.findAll({
        
        where: {
            withdrawn: null,
            expires: { [sequelize.Op.lt]: new Date },
        },
    });

    let families = new Set;

    for (let item of products) {
        families.add(item.family);
    }

    families = Array.from(families);

    let users = await db.models.User.findAll({
        where: {
            family: { [sequelize.Op.in]: families }
        }
    });

    for (let user of users) {
        try {
            await bot.telegram.sendMessage(user.id, '❗ Есть просроченные продукты. Используйте /listexpired для просмотра списка');
        }
        catch {
            // Nothing critical happened, so not doing anything
        }
    }
}

async function cleanupWithdrawnProducts() {
    let aWeekAgo = new Date((+new Date) - (1000 * 86400 * 7));
    let deletedCount = await db.models.Product.destroy({
        where: {
            withdrawn: { [sequelize.Op.ne]: null },
            expires: { [sequelize.Op.lt]: aWeekAgo },
        },
    });
    console.log(`Deleted ${deletedCount} withdrawn products`);
}

new cron.CronJob('0 10 * * *', notifyAboutExpiredProducts, undefined, true);
console.log(`Notification cron job will start at ${cron.sendAt('0 10 * * *')}`);

new cron.CronJob('0 0 * * *', cleanupWithdrawnProducts, undefined, true);
console.log(`Cleanup cron job will start at ${cron.sendAt('0 0 * * *')}`);
