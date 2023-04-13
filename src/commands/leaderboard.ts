import Discord, { MessageActionRow, MessageButton } from 'discord.js'
import Command from '../struct/Command.js'
import User from '../struct/User.js'

export default new Command({
    name: 'leaderboard',
    description: 'Points leaderboard!',
    args: [
        {
            name: 'global',
            description: `Show NASBS leaderboard for all teams`,
            required: false,
            optionType: 'boolean'
        },
        {
            name: 'metric',
            description: 'What metric to rank people by (default is points)',
            choices: [
                Array(2).fill('points'),
                Array(2).fill('buildings'),
                Array(2).fill('roads'),
                Array(2).fill('land')
            ],
            required: false,
            optionType: 'string'
        }
    ],
    async run(i, client) {
        const guild = client.guildsData.get(i.guild.id)
        const options = i.options
        const metric: string = options.getString('metric') || 'points'
        // convert metric to the name in the database
        const dbAttrName = (() => {
            switch (metric) {
                case 'points': return 'pointsTotal'
                case 'buildings': return 'buildingCount'
                case 'roads': return 'roadKMs'
                case 'land': return 'sqm'
            }
        })()
        // get units of the selected metric
        const units = (() => {
            switch (metric) {
                case 'points': return 'points'
                case 'buildings': return 'buildings'
                case 'roads': return 'km'
                case 'land': return 'm²'
            }
        })()
        const pageLength = 10
        let page = 1
        let users
        let guildName

        if (options.getBoolean('global')) {
            guildName = 'all build teams'
            // get array of all users and their global points, sort descending
            users = await User.aggregate([
                {
                    $group: {
                        _id: '$id',
                        count: { $sum: `$${dbAttrName}` }
                    }
                },
                { $sort: { count: -1 } }
            ])
        } else {
            guildName = guild.name
            // or get array of all users in this guild and their points, sort descending
            users = await User.aggregate([
                { $match: { guildId: guild.id } },
                {
                    $group: {
                        _id: '$id',
                        count: { $sum: `$${dbAttrName}` }
                    }
                },
                { $sort: { count: -1 } }
            ])
        }

        const maxPage = Math.ceil(users.length / pageLength)

        // make buttons
        const previousButton = new MessageButton()
            .setCustomId('previous')
            .setLabel('Previous page')
            .setStyle('PRIMARY')

        const nextButton = new MessageButton()
            .setCustomId('next')
            .setLabel('Next page')
            .setStyle('PRIMARY')

        // create the embed for any page of leaderboard
        function makeEmbed(page) {
            let content = ''

            for (let i = page * pageLength - pageLength; i < page * pageLength; i++) {
                if (!users[i]) break
                const value = (() => {
                    if (/[\.]/.test(users[i].count)) {  // if the value is a float
                        return parseFloat(users[i].count).toFixed(1)
                    } else {  // if the value is an int
                        return users[i].count
                    }
                })()
                content += `**${i + 1}.** <@${users[i]._id}>: ${value} ${units}\n\n`
            }

            const capitalizedMetric = metric.charAt(0).toUpperCase() + metric.slice(1)  // Capitalize first letter of metric
            const embed = new Discord.MessageEmbed()
                .setTitle(`${capitalizedMetric} leaderboard for ${guildName}!`)
                .setDescription(content)

            return embed
        }

        // reply with page 1 and next button
        // if there's only 1 leaderboard page, no buttons
        // use less than one, because an empty leaderboard has no pages
        if (maxPage <= 1) {
            await i.reply({
                embeds: [makeEmbed(page)]
            })
        } else {
            // otherwise, add a next button
            await i.reply({
                embeds: [makeEmbed(1)],
                components: [new MessageActionRow().addComponents(nextButton)]
            })
        }

        const reply = await i.fetchReply()
        const replyMsg = await i.channel.messages.fetch(reply.id)

        const filter = (button) => button.customId == 'previous' || button.customId == 'next'

        // listen for button pressed
        function buttonListener() {
            replyMsg
                .awaitMessageComponent({
                    filter,
                    time: 12 * 60 * 60 * 1000
                })
                // when button is pressed, update the embed and page value accordingly, then start another listener
                .then(async (i) => {
                    if (i.customId == 'previous') {
                        page -= 1
                        // no previous button allowed if its the 1st page (or negative page, error or empty leaderboard)
                        if (page <= 1) {
                            await i.update({
                                embeds: [makeEmbed(page)],
                                components: [new MessageActionRow().addComponents(nextButton)]
                            })
                        } else {
                            await i.update({
                                embeds: [makeEmbed(page)],
                                components: [
                                    new MessageActionRow().addComponents(
                                        previousButton,
                                        nextButton
                                    )
                                ]
                            })
                        }
                    } else if (i.customId == 'next') {
                        page += 1
                        // no next button allowed if its the last page
                        if (page == maxPage) {
                            await i.update({
                                embeds: [makeEmbed(page)],
                                components: [
                                    new MessageActionRow().addComponents(previousButton)
                                ]
                            })
                        } else {
                            await i.update({
                                embeds: [makeEmbed(page)],
                                components: [
                                    new MessageActionRow().addComponents(
                                        previousButton,
                                        nextButton
                                    )
                                ]
                            })
                        }
                    }
                    buttonListener()
                })
                .catch((err) => {
                    return err
                })
        }
        buttonListener()
    }
})
