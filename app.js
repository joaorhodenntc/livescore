const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const token = '6323285955:AAFYiFWnG0aLKmhxFD-orRu7KwmXhjJ7gUY';
const chat_bot = '-1002576823211';

const API_KEY = 'c16ba32e0dd38a8ef4b4c90a570d380f0665716e4b214e3715a2448fce6d7656';
const URL = `https://apiv2.allsportsapi.com/football/?met=Livescore&APIkey=${API_KEY}`;
const LIVE_ODDS = `https://apiv2.allsportsapi.com/football/?met=OddsLive&APIkey=${API_KEY}&matchId=`;

const bot = new TelegramBot(token, { polling: false });
const notifiedMatches = new Set();

async function enviarMensagemTelegram(chat_id, mensagem) {
    try {
        const sentMessage = await bot.sendMessage(chat_id, mensagem, { parse_mode: 'Markdown', disable_web_page_preview: true });
        return sentMessage.message_id;
    } catch (error) {
        console.error('Erro ao enviar mensagem para o Telegram:', error);
    }
}

function calculateGoalLimit(score) {
    if (!score || typeof score !== 'string') return null;
    const [homeGoals, awayGoals] = score.split(' - ').map(Number);
    if (isNaN(homeGoals) || isNaN(awayGoals)) return null;
    return (homeGoals + awayGoals) + 0.5;
}

function isAfter65Minutes(status) {
    if (status > 65 && status < 90) {
        return true;
    }
    return false;
}

async function getOdd(eventKey) {
    try {
        const response = await axios.get(`https://apiv2.allsportsapi.com/football/?&met=Odds&matchId=${eventKey}&APIkey=${API_KEY}`);
        const allOdds = response.data.result;

        if (!allOdds || typeof allOdds !== 'object') return null;

        const matchOddsArray = allOdds[eventKey];

        if (!matchOddsArray || !Array.isArray(matchOddsArray)) return null;

        const bet365Odds = matchOddsArray.find(odd => odd.odd_bookmakers.toLowerCase() === 'bet365');

        if (bet365Odds) {
            return {
                odd_1: bet365Odds.odd_1 || 0,
                odd_x: bet365Odds.odd_x || 0,
                odd_2: bet365Odds.odd_2 || 0
            };
        } else {
            return null;
        }
    } catch (error) {
        console.error(`❌ Erro ao buscar odds para eventKey ${eventKey}:`, error.message);
        return null;
    }
}

async function getLiveOdds(matchId, goalLimit) {
    try {
        const response = await axios.get(`${LIVE_ODDS}${matchId}`);
        const matches = response.data.result;
        const oddsArray = matches[matchId];

        if (!oddsArray || !Array.isArray(oddsArray)) return null;

        const filteredOdds = oddsArray.find(odd =>
            odd.odd_name === 'Over/Under Line' &&
            odd.odd_type === 'Over' &&
            parseFloat(odd.odd_participant_handicap) === goalLimit &&
            odd.is_odd_suspended === 'No'
        );

        if (filteredOdds && parseFloat(filteredOdds.odd_value) >= 1.57) {
            return {
                odd_value: filteredOdds.odd_value,
                handicap: filteredOdds.odd_participant_handicap,
                last_updated: filteredOdds.odd_last_updated
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function fetchLivescores() {
    try {
        const response = await axios.get(URL);

        if (response.data && response.data.result) {
            const matches = response.data.result;
            console.log(`⚽ Total de jogos ao vivo: ${matches.length}\n`);

            for (let i = 0; i < matches.length; i++) {
                const match = matches[i];
                const goalLimit = calculateGoalLimit(match.event_final_result);
                const odds = await getOdd(match.event_key);
                const liveOdds = goalLimit ? await getLiveOdds(match.event_key, goalLimit) : null;

                const dangerousAttacks = match.statistics?.find(stat => stat.type === 'Dangerous Attacks');
                const shots = match.statistics?.find(stat => stat.type === 'Shots Inside Box');

                const nameHomeFormatted = match.event_home_team.replace(/\s+/g, '%20');
                const link = `https://www.bet365.bet.br/#/AX/K%5E${nameHomeFormatted}%20`;

                if (
                    odds &&
                    odds.odd_1 && odds.odd_2 &&
                    dangerousAttacks &&
                    (odds.odd_1 < 29 || odds.odd_2 < 20) &&
                    dangerousAttacks.home > 1 &&
                    liveOdds &&  
                    isAfter65Minutes(match.event_status) &&
                    !notifiedMatches.has(match.event_key)
                ) {
                    let finalizacoesTexto = '';
                    if (shots?.home !== undefined && shots?.away !== undefined) {
                        finalizacoesTexto = `🥅 Finalizações: ${shots.home} x ${shots.away}\n`;
                    }

                    const mensagem =
                        `*🤖 BETSMART*\n\n` +
                        `${match.event_home_team} vs ${match.event_away_team}\n\n` +
                        `⚽️ Placar: ${match.event_final_result}\n` +
                        `⚔️ Ataques Perigosos: ${dangerousAttacks.home} x ${dangerousAttacks.away}\n` +
                        finalizacoesTexto +
                        `🕛 Tempo: ${match.event_status}\n` +
                         `*🤖 Entrar em OVER ${liveOdds?.handicap} GOLS*\n\n` +
                        `${link}`;

                    console.log(
                        `${match.event_key}\n` +
                        `${match.event_home_team} ${match.event_final_result} ${match.event_away_team} - ${match.event_status}\n` +
                        `Ataques Perigosos: ${dangerousAttacks.home} | ${dangerousAttacks.away}\n`
                    );

                    await enviarMensagemTelegram(chat_bot, mensagem);
                    notifiedMatches.add(match.event_key);
                }
            }
        } else {
            console.log("Nenhum resultado encontrado ou estrutura inesperada da resposta.");
        }
    } catch (error) {
        console.error("Erro ao buscar dados:", error.message);
    }
}

fetchLivescores();
setInterval(fetchLivescores, 60000); // Executa a cada 60 segundos
