var config = {};
const genericQueueId = '843c2b42-6747-4b16-9d61-c60b3bf9f144'
const queueDataTokenURI = "https://l716g7cjn8.execute-api.us-east-1.amazonaws.com/dev/api/signin-cge"
//const queueDataReportURI = "https://ctu47v13xf.execute-api.us-east-2.amazonaws.com/default/getQueueDataReport"
const queueDataReportURI = "https://l716g7cjn8.execute-api.us-east-1.amazonaws.com/dev/api/queuereportdata"
const pollingTime = 30000;//milliseconds
var token;
var queues = [];
var outcomes = [];

$(document).ready(function(){
	$("#errorMessage").hide();
    if(window.location.hash) 
    {	
        config.environment = getParameterByName('environment', window.location.search);               
        token = getParameterByName('access_token', window.location.hash);
        location.hash = '';
        update();
        
    }
    else
    {	
        //Config Genesys Cloud
        config = {
            "environment": getParameterByName('environment', window.location.search),
            "clientId": getParameterByName('clientId', window.location.search),
            "redirectUri": getParameterByName('redirectUri', window.location.search)

        };
        
        var queryStringData = {
            response_type: "token",
            client_id: config.clientId,
            redirect_uri: config.redirectUri
        }        
        
        window.location.replace("https://login." + config.environment + "/authorize?" + jQuery.param(queryStringData));
    }

});


function getParameterByName(name, data) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\#&?]" + name + "=([^&#?]*)"),
      results = regex.exec(data);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
};

async function update(){    
    const pageSize = 100;
    let pageNumber = 1;
    let flagWaitingConversations = true;
    let startDate = new Date();   
    let endDate = new Date();
    let sleepTime = 2000; //milliseconds

    //get Catalogs
    try {
        await getCatalog(token, "routing/queues");
        await getCatalog(token, "flows/outcomes");

    } catch (e) {
        showError(e);
        await sleep(sleepTime);
        update();
        return;
    }     

    endDate.setDate(endDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0); 
    let conversations = [];

    //Get waiting conversations - En Cola
    while(flagWaitingConversations){
        tmpConversations = [];
        try {
            tmpConversations = await getWaitingConversations(token, startDate, endDate, pageNumber, pageSize);        
            conversations = conversations.concat(tmpConversations);
        } catch (e) {
            showError(e);
            await sleep(sleepTime);
            update();
            return;
        }        
        
        if (tmpConversations.length == pageSize) {
            pageNumber++;
        }
        else{
            flagWaitingConversations = false;
        }
    }

    console.log(conversations, "waiting-calls")
    if(!conversations){
       conversations = [];
    }    
    
    let regionData = [];        
    let regionServiceData = [];
    
    const agentData = await getQueueObservationData(token, genericQueueId);
    console.log(agentData[0], "agentData")
    const queueDataToken = await getQueueDataToken();
    //console.log(queueDataToken, "queueDataToken");

    const queueDataReport = await getQueueDataReport(queueDataToken);
    //const queueDataReport = await getQueueDataReport();
   
    $.each(queueDataReport, function (index, item) { 
        item.onQueue = 0      

        if(item.service){   
            item = setCalculatedFields(item);  
            const onQueueValue = conversations.filter(c => c.flowOutcomes && c.flowOutcomes.includes(item.region) && c.queueName == item.service)
            if(onQueueValue)
            item.onQueue = onQueueValue.length

            regionServiceData.push({ ...item });
        }

        const regionDataItem = regionData.find(i => i.region == item.region);  

        if(regionDataItem){  
            item.offered = item.offered + regionDataItem.offered;
            item.answered = item.answered + regionDataItem.answered;
            item.abandon = item.abandon + regionDataItem.abandon;
            item.nServiceLevel = item.nServiceLevel + regionDataItem.nServiceLevel;
            item.tHandle = item.tHandle + regionDataItem.tHandle;
            item.transferred = item.transferred + regionDataItem.transferred; 
            item.onQueue = item.onQueue + regionDataItem.onQueue;                
            regionData = regionData.filter(i => i.region != item.region)
            item = setCalculatedFields(item);
            regionData.push({ ...item })
        }
        else{
            item = setCalculatedFields(item);
            regionData.push({ ...item })
        } 
        
     });

    updateAgentData(agentData);
    updateRegionData(regionData);
    updateRegionServiceData(regionServiceData);
    setTimeout(update, pollingTime);
}

function setCalculatedFields(item){

    if(item.offered > 0)
        item.answeredPercent = item.answered / item.offered;
    else
        item.answeredPercent = 0;            

    if(item.answered > 0)
        item.servicePercent = item.nServiceLevel / item.answered;
    else
        item.servicePercent = 0;
    
    if(item.answered > 0)
        item.tmo = (item.tHandle / item.answered / 1000).toFixed(2);
    else
        item.tmo = 0;

    //Percentage format
    item.servicePercent = parseFloat(item.servicePercent * 100).toFixed(2)+"%"
    item.answeredPercent = parseFloat(item.answeredPercent * 100).toFixed(2)+"%" 
    
    return item

}
function getWaitingConversations(token, startDate, endDate, pageNumber, pageSize = 100){

    const query = {
        interval: startDate.toISOString() + "/" + endDate.toISOString(),
        "paging": {
            "pageSize": pageSize,
            "pageNumber": pageNumber
           },          
           "segmentFilters":[{"type":"or","predicates":[{"dimension":"direction","value":"inbound"},{"dimension":"direction","value":"outbound"}]},           
           {"type":"or","clauses":[{"type":"and","predicates":[{"dimension":"purpose","operator":"matches","value":"acd"},{"dimension":"segmentEnd","operator":"notExists"},{"dimension":"segmentType","operator":"matches","value":"interact"}]}]}]                      

    };

    //console.log(query, "QUERY");
    let url = "https://api." + config.environment + "/api/v2/" + "analytics/conversations/details/query";
    let conversations = [];

    return new Promise((resolve, reject) => {
        $.ajax({
            url: url,
            type: "POST",
            beforeSend: function (xhr) { xhr.setRequestHeader('Authorization', 'bearer ' + token); },
            contentType: "application/json",
            dataType: 'json',
            data: JSON.stringify(query),			
            success: function (result) {            
                //console.log(result.conversations, "getWaitingConversations - page: " + pageNumber);
                if (result && result.conversations) {                  
                    $.each(result.conversations, function (index, conversation) {
                        const acdParticipant = conversation.participants.find(p => p.purpose == "acd");                    
                        if(acdParticipant){                        
                            const session = acdParticipant.sessions.find(s => s.mediaType == "voice");
                            if(session){
                                if(session.segments && session.segments.length > 0){
                                    
                                    const segment = session.segments[0];
                                    conversation.queueId = segment.queueId;                                    
                                    const queue = queues.find(function (r) { return r.id === conversation.queueId });

                                    if(queue){
                                        conversation.queueName = queue.name;                                       
                                    }                                    

                                }                                                           
                            }
                        }
                        const ivrParticipant = conversation.participants.find(p => p.purpose == "ivr");                    
                        if(ivrParticipant){ 
                            const session = ivrParticipant.sessions.find(s => s.mediaType == "voice");
                            if(session){                               
                                if(session.flow && session.flow.outcomes) {
                                    conversation.flowOutcomes = []; 
                                    $.each(session.flow.outcomes, function (index, flowOutcome) {
                                        const outcome = outcomes.find(function (o) { return o.id === flowOutcome.flowOutcomeId });                                        
                                        if(outcome){
                                            
                                            conversation.flowOutcomes.push(outcome.name);                                                   
                                        }
                                        
                                    });

                                }                              
                            }

                        } 
                        
                        conversations.push(conversation);                            
                    });
                    
                }
                resolve(conversations);                
            },
            error: function (request) {
                console.log("getWaitingConversations-error", request);                
                reject("get-waiting-conversations -> " + JSON.stringify(request));

            }
        }); 
    });

}

function getQueueObservationData(token, queueId){
    const query =  {
        "filter": {
         "type": "and",
         "predicates": [
          {
           "type": "dimension",
           "dimension": "queueId",
           "operator": "matches",
           "value": queueId
          }
         ]
        },
        "metrics": [
         "oActiveUsers",
         "oInteracting",
         "oMemberUsers",
         "oOffQueueUsers",
         "oOnQueueUsers",
         "oUserPresences",
         "oUserRoutingStatuses",
         "oWaiting"
        ]
    };

    const url = "https://api." + config.environment + "/api/v2/" + "analytics/queues/observations/query";
    
    return new Promise((resolve, reject) => {
        let queueObservationData = {connected: 0, talk: 0, available: 0, notAvailable: 0};
        
        $.ajax({
            url: url,
            type: "POST",
            beforeSend: function (xhr) { xhr.setRequestHeader('Authorization', 'bearer ' + token); },
            contentType: "application/json",
            dataType: 'json',
            data: JSON.stringify(query),			
            success: function (result) {     
                $.each(result.results, function (index, item) {                   
                    if(item.group && !item.group.mediaType){                        
                        $.each(item.data, function (idx, metric) {                   
                            console.log(metric, "metric")
                            if(metric.metric    === "oActiveUsers" && metric.stats){
                                queueObservationData.connected = metric.stats.count;
                            }
                            
                            if(metric.metric === "oOnQueueUsers" && metric.qualifier == 'IDLE' && metric.stats){
                                queueObservationData.talk = metric.stats.count;
                            }
                            
                            if(metric.metric === "oUserPresences" && metric.qualifier == '6a3af858-942f-489d-9700-5f9bcdcdae9b' &&  metric.stats){
                                queueObservationData.available = metric.stats.count;
                            }
                            
                            queueObservationData.notAvailable = queueObservationData.connected - queueObservationData.talk - queueObservationData.available;
                            
                         });
                                                
                    }
                 });
                

                resolve([queueObservationData]);                
            },
            error: function (request) {
                console.log("getQueueObservationData-error", request);                
                reject("getQueueObservationData -> " + JSON.stringify(request));

            }
        }); 
    });

}

function getQueueDataReport(token) { 
    let url = queueDataReportURI;

    return new Promise((resolve, reject) => {
        $.ajax({
            url: url,
            type: "GET",            
            headers: {
                'Authorizer': token,
                'Authorization': 'Basic SVVfR05TWUNfQ0dFOkluaWNpbzAxIw=='                
            },
            success: function (result) {
               console.log(result, "getQueueDataReport")
                resolve(result);
            
            },
            error: function (request, otro) {
                console.log("getCatalog - error", "url: " + url + ", detail: " + JSON.stringify(request));                                       
                reject("get-catalog-" + name + " -> " + JSON.stringify(request));                     
                
            }
        });
    });
    
};



function getCatalog(token, name) { 
    let url = "https://api." + config.environment + "/api/v2/" + name + "?pageSize=500&pageNumber=1";

    return new Promise((resolve, reject) => {
        $.ajax({
            url: url,
            type: "GET",
            beforeSend: function (xhr) { xhr.setRequestHeader('Authorization', 'bearer ' + token); },
            success: function (result) {
                if (name == "routing/queues"){
                    queues = result.entities; 
                }                                  
                else if (name == "flows/outcomes"){
                    outcomes = result.entities;                    
                }
                resolve(result);
            
            },
            error: function (request, otro) {
                console.log("getCatalog - error", "url: " + url + ", detail: " + JSON.stringify(request));                                       
                reject("get-catalog-" + name + " -> " + JSON.stringify(request));                     
                
            }
        });
    });
    
};


function getQueueDataToken(){
    const query =  {
        IdCliente:"gabriel.amarillo@genesys.com",
        Pass:"Genesys-2022"
    };
    
    return new Promise((resolve, reject) => {
                
        $.ajax({
            url: queueDataTokenURI,
            type: "POST",           
            contentType: "application/json",
            dataType: 'json',
            data: JSON.stringify(query),			
            success: function (result) { 
                if(!result){
                    result = {Token: ''} 
                }                    
              
                resolve(result.Token);                
            },
            error: function (request) {
                console.log("getQueueDataToken-error", request);                
                reject("getQueueDataToken -> " + JSON.stringify(request));

            }
        }); 
    });

}

function updateAgentData(data){    
    $("#errorMessage").hide();
    const tableBody = $("#agentDataTable");
    tableBody.empty();
    
    $.each(data, function (index, item) {                   
        tableBody.append('<tr> <td class="numberColumn">' + item.connected + '</td><td class="numberColumn">' + item.talk + '</td><td class="numberColumn">' + item.available + '</td><td class="numberColumn">' + item.notAvailable + '</td><tr>');
     });
     

};

function updateRegionData(data){
    $("#errorMessage").hide();
    const tableBody = $("#regionTable");
    tableBody.empty();
    $.each(data, function (index, item) {                   
        tableBody.append('<tr> <td>' + item.region + '</td><td class="numberColumn">' + item.offered + '</td><td class="numberColumn">' + item.answered + '</td><td class="numberColumn">' + item.abandon + '</td><td class="numberColumn">' + item.onQueue + '</td><td class="numberColumn">' + item.tmo + '</td><td class="numberColumn">' + item.transferred + '</td><td class="numberColumn">' + item.answeredPercent + '</td><td class="numberColumn">' + item.servicePercent + '</td><tr>');
     });

};

function updateRegionServiceData(data){
    $("#errorMessage").hide();
    const tableBody = $("#regionServiceTable");
    tableBody.empty();
    $.each(data, function (index, item) {                   
        tableBody.append('<tr> <td>' + item.region + '</td><td>' + item.service + '</td><td class="numberColumn">' + item.offered + '</td><td class="numberColumn">' + item.answered + '</td><td class="numberColumn">' + item.abandon + '</td><td class="numberColumn">' + item.onQueue + '</td><td class="numberColumn">' + item.tmo + '</td><td class="numberColumn">' + item.transferred + '</td><td class="numberColumn">' + item.answeredPercent + '</td><td class="numberColumn">' + item.servicePercent + '</td><tr>');
     });

};

function showError(text){    
    const divError = $("#errorMessage");
    if(divError && text){
        divError.text(text); 
        divError.show(); 
    }
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

//http://127.0.0.1:8887?environment=mypurecloud.com&clientId=94780cdf-ec5c-45b8-a637-c52f64fba3ef&redirectUri=http%3A%2F%2F127.0.0.1%3A8887%3Fenvironment%3Dmypurecloud.com
