module.exports = class Utils {
    static sanitizeEpisode(episodeTitle) {
        return episodeTitle.replace(new RegExp('/','g'),'-').trim()
    }
    
    static sanitizeContent(str) {
        if (typeof str !== 'string') {
            str = {
                nonstring: str
            }
    
            str = JSON.stringify(str)
        }
        return str.replace(/"/gi,'&quot;')
                  .replace(/&/gi,'&amp;')
                  .replace(/</gi,'&lt;')
                  .replace(/>/gi,'&gt;')
                  .replace(/'/gi,'')
                  .replace(/ /gi,'_')
                  .replace(/á/gi,'a')
                  .replace(/é/gi,'e')
                  .replace(/í/gi,'i')
                  .replace(/ó/gi,'o')
                  .replace(/ú/gi,'u')
    }

    static parseResponse(response) {
        let result = '';

        if (response.indexOf('413_Request_Entity_Too_Large') > -1) {
            result = 'file_too_large';
        }

        return result;
    }
}
