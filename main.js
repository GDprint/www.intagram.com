/*
 * Copyright (c) 2014 - present Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

// This is a transport injected into the browser via a script that handles the low
// level communication between the live development protocol handlers on both sides.
// This transport provides a web socket mechanism. It's injected separately from the
// protocol handler so that the transport can be changed separately.

(function (global) {
    "use strict";

    var WebSocketTransport = {
        /**
         * @private
         * The WebSocket that we communicate with Brackets over.
         * @type {?WebSocket}
         */
        _ws: null,

        /**
         * @private
         * An object that contains callbacks to handle various transport events. See `setCallbacks()`.
         * @type {?{connect: ?function, message: ?function(string), close: ?function}}
         */
        _callbacks: null,

        /**
         * Sets the callbacks that should be called when various transport events occur. All callbacks
         * are optional, but you should at least implement "message" or nothing interesting will happen :)
         * @param {?{connect: ?function, message: ?function(string), close: ?function}} callbacks
         *      The callbacks to set.
         *      connect - called when a connection is established to Brackets
         *      message(msgStr) - called with a string message sent from Brackets
         *      close - called when Brackets closes the connection
         */
        setCallbacks: function (callbacks) {
            if (!global._Brackets_LiveDev_Socket_Transport_URL) {
                console.error("[Brackets LiveDev] No socket transport URL injected");
            } else {
                this._callbacks = callbacks;
            }
        },

        /**
         * Connects to the NodeSocketTransport in Brackets at the given WebSocket URL.
         * @param {string} url
         */
        connect: function (url) {
            var self = this;
            this._ws = new WebSocket(url);

            // One potential source of confusion: the transport sends two "types" of messages -
            // these are distinct from the protocol's own messages. This is because this transport
            // needs to send an initial "connect" message telling the Brackets side of the transport
            // the URL of the page that it's connecting from, distinct from the actual protocol
            // message traffic. Actual protocol messages are sent as a JSON payload in a message of
            // type "message".
            //
            // Other transports might not need to do this - for example, a transport that simply
            // talks to an iframe within the same process already knows what URL that iframe is
            // pointing to, so the only comunication that needs to happen via postMessage() is the
            // actual protocol message strings, and no extra wrapping is necessary.

            this._ws.onopen = function (event) {
                // Send the initial "connect" message to tell the other end what URL we're from.
                self._ws.send(JSON.stringify({
                    type: "connect",
                    url: global.location.href
                }));
                console.log("[Brackets LiveDev] Connected to Brackets at " + url);
                if (self._callbacks && self._callbacks.connect) {
                    self._callbacks.connect();
                }
            };
            this._ws.onmessage = function (event) {
                console.log("[Brackets LiveDev] Got message: " + event.data);
                if (self._callbacks && self._callbacks.message) {
                    self._callbacks.message(event.data);
                }
            };
            this._ws.onclose = function (event) {
                self._ws = null;
                if (self._callbacks && self._callbacks.close) {
                    self._callbacks.close();
                }
            };
            // TODO: onerror
        },

        /**
         * Sends a message over the transport.
         * @param {string} msgStr The message to send.
         */
        send: function (msgStr) {
            if (this._ws) {
                // See comment in `connect()` above about why we wrap the message in a transport message
                // object.
                this._ws.send(JSON.stringify({
                    type: "message",
                    message: msgStr
                }));
            } else {
                console.log("[Brackets LiveDev] Tried to send message over closed connection: " + msgStr);
            }
        },

        /**
         * Establish web socket connection.
         */
        enable: function () {
            this.connect(global._Brackets_LiveDev_Socket_Transport_URL);
        }
    };
    global._Brackets_LiveDev_Transport = WebSocketTransport;
}(this));
this._Brackets_LiveDev_Socket_Transport_URL = 'ws://localhost:8123'; <
/script> <
script >
    /*
     * Copyright (c) 2014 - present Adobe Systems Incorporated. All rights reserved.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a
     * copy of this software and associated documentation files (the "Software"),
     * to deal in the Software without restriction, including without limitation
     * the rights to use, copy, modify, merge, publish, distribute, sublicense,
     * and/or sell copies of the Software, and to permit persons to whom the
     * Software is furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
     * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
     * DEALINGS IN THE SOFTWARE.
     *
     */

    /*jslint evil: true */

    // This is the script that Brackets live development injects into HTML pages in order to
    // establish and maintain the live development socket connection. Note that Brackets may
    // also inject other scripts via "evaluate" once this has connected back to Brackets.

    (function (global) {
        "use strict";

        // This protocol handler assumes that there is also an injected transport script that
        // has the following methods:
        //     setCallbacks(obj) - a method that takes an object with a "message" callback that
        //         will be called with the message string whenever a message is received by the transport.
        //     send(msgStr) - sends the given message string over the transport.
        var transport = global._Brackets_LiveDev_Transport;

        /**
         * Manage messaging between Editor and Browser at the protocol layer.
         * Handle messages that arrives through the current transport and dispatch them
         * to subscribers. Subscribers are handlers that implements remote commands/functions.
         * Property 'method' of messages body is used as the 'key' to identify message types.
         * Provide a 'send' operation that allows remote commands sending messages to the Editor.
         */
        var MessageBroker = {

            /**
             * Collection of handlers (subscribers) per each method.
             * To be pushed by 'on' and consumed by 'trigger' stored this way:
             *      handlers[method] = [handler1, handler2, ...]
             */
            handlers: {},

            /**
             * Dispatch messages to handlers according to msg.method value.
             * @param {Object} msg Message to be dispatched.
             */
            trigger: function (msg) {
                var msgHandlers;
                if (!msg.method) {
                    // no message type, ignoring it
                    // TODO: should we trigger a generic event?
                    console.log("[Brackets LiveDev] Received message without method.");
                    return;
                }
                // get handlers for msg.method
                msgHandlers = this.handlers[msg.method];

                if (msgHandlers && msgHandlers.length > 0) {
                    // invoke handlers with the received message
                    msgHandlers.forEach(function (handler) {
                        try {
                            // TODO: check which context should be used to call handlers here.
                            handler(msg);
                            return;
                        } catch (e) {
                            console.log("[Brackets LiveDev] Error executing a handler for " + msg.method);
                            console.log(e.stack);
                            return;
                        }
                    });
                } else {
                    // no subscribers, ignore it.
                    // TODO: any other default handling? (eg. specific respond, trigger as a generic event, etc.);
                    console.log("[Brackets LiveDev] No subscribers for message " + msg.method);
                    return;
                }
            },

            /**
             * Send a response of a particular message to the Editor.
             * Original message must provide an 'id' property
             * @param {Object} orig Original message.
             * @param {Object} response Message to be sent as the response.
             */
            respond: function (orig, response) {
                if (!orig.id) {
                    console.log("[Brackets LiveDev] Trying to send a response for a message with no ID");
                    return;
                }
                response.id = orig.id;
                this.send(response);
            },

            /**
             * Subscribe handlers to specific messages.
             * @param {string} method Message type.
             * @param {function} handler.
             * TODO: add handler name or any identification mechanism to then implement 'off'?
             */
            on: function (method, handler) {
                if (!method || !handler) {
                    return;
                }
                if (!this.handlers[method]) {
                    //initialize array
                    this.handlers[method] = [];
                }
                // add handler to the stack
                this.handlers[method].push(handler);
            },

            /**
             * Send a message to the Editor.
             * @param {string} msgStr Message to be sent.
             */
            send: function (msgStr) {
                transport.send(JSON.stringify(msgStr));
            }
        };

        /**
         * Runtime Domain. Implements remote commands for "Runtime.*"
         */
        var Runtime = {
            /**
             * Evaluate an expresion and return its result.
             */
            evaluate: function (msg) {
                console.log("Runtime.evaluate");
                var result = eval(msg.params.expression);
                MessageBroker.respond(msg, {
                    result: JSON.stringify(result) // TODO: in original protocol this is an object handle
                });
            }
        };

        // subscribe handler to method Runtime.evaluate
        MessageBroker.on("Runtime.evaluate", Runtime.evaluate);

        /**
         * CSS Domain.
         */
        var CSS = {

            setStylesheetText: function (msg) {

                if (!msg || !msg.params || !msg.params.text || !msg.params.url) {
                    return;
                }

                var i,
                    node;

                var head = window.document.getElementsByTagName('head')[0];
                // create an style element to replace the one loaded with <link>
                var s = window.document.createElement('style');
                s.type = 'text/css';
                s.appendChild(window.document.createTextNode(msg.params.text));

                for (i = 0; i < window.document.styleSheets.length; i++) {
                    node = window.document.styleSheets[i];
                    if (node.ownerNode.id === msg.params.url) {
                        head.insertBefore(s, node.ownerNode); // insert the style element here
                        // now can remove the style element previously created (if any)
                        node.ownerNode.parentNode.removeChild(node.ownerNode);
                    } else if (node.href === msg.params.url && !node.disabled) {
                        // if the link element to change
                        head.insertBefore(s, node.ownerNode); // insert the style element here
                        node.disabled = true;
                        i++; // since we have just inserted a stylesheet
                    }
                }
                s.id = msg.params.url;
            },

            /**
             * retrieves the content of the stylesheet
             * TODO: it now depends on reloadCSS implementation
             */
            getStylesheetText: function (msg) {
                var i,
                    sheet,
                    text = "";
                for (i = 0; i < window.document.styleSheets.length; i++) {
                    sheet = window.document.styleSheets[i];
                    // if it was already 'reloaded'
                    if (sheet.ownerNode.id === msg.params.url) {
                        text = sheet.ownerNode.textContent;
                    } else if (sheet.href === msg.params.url && !sheet.disabled) {
                        var j,
                            rules;

                        // Deal with Firefox's SecurityError when accessing sheets
                        // from other domains, and Chrome returning `undefined`.
                        try {
                            rules = window.document.styleSheets[i].cssRules;
                        } catch (e) {
                            if (e.name !== "SecurityError") {
                                throw e;
                            }
                        }
                        if (!rules) {
                            return;
                        }

                        for (j = 0; j < rules.length; j++) {
                            text += rules[j].cssText + '\n';
                        }
                    }
                }

                MessageBroker.respond(msg, {
                    text: text
                });
            }
        };

        MessageBroker.on("CSS.setStylesheetText", CSS.setStylesheetText);
        MessageBroker.on("CSS.getStylesheetText", CSS.getStylesheetText);

        /**
         * Page Domain.
         */
        var Page = {
            /**
             * Reload the current page optionally ignoring cache.
             * @param {Object} msg
             */
            reload: function (msg) {
                // just reload the page
                window.location.reload(msg.params.ignoreCache);
            },

            /**
             * Navigate to a different page.
             * @param {Object} msg
             */
            navigate: function (msg) {
                if (msg.params.url) {
                    // navigate to a new page.
                    window.location.replace(msg.params.url);
                }
            }
        };

        // subscribe handler to method Page.reload
        MessageBroker.on("Page.reload", Page.reload);
        MessageBroker.on("Page.navigate", Page.navigate);
        MessageBroker.on("ConnectionClose", Page.close);



        // By the time this executes, there must already be an active transport.
        if (!transport) {
            console.error("[Brackets LiveDev] No transport set");
            return;
        }

        var ProtocolManager = {

            _documentObserver: {},

            _protocolHandler: {},

            enable: function () {
                transport.setCallbacks(this._protocolHandler);
                transport.enable();
            },

            onConnect: function () {
                this._documentObserver.start(window.document, transport);
            },

            onClose: function () {
                var body = window.document.getElementsByTagName("body")[0],
                    overlay = window.document.createElement("div"),
                    background = window.document.createElement("div"),
                    status = window.document.createElement("div");

                overlay.style.width = "100%";
                overlay.style.height = "100%";
                overlay.style.zIndex = 2227;
                overlay.style.position = "fixed";
                overlay.style.top = 0;
                overlay.style.left = 0;

                background.style.backgroundColor = "#fff";
                background.style.opacity = 0.5;
                background.style.width = "100%";
                background.style.height = "100%";
                background.style.position = "fixed";
                background.style.top = 0;
                background.style.left = 0;

                status.textContent = "Live Development Session has Ended";
                status.style.width = "100%";
                status.style.color = "#fff";
                status.style.backgroundColor = "#666";
                status.style.position = "fixed";
                status.style.top = 0;
                status.style.left = 0;
                status.style.padding = "0.2em";
                status.style.verticalAlign = "top";
                status.style.textAlign = "center";
                overlay.appendChild(background);
                overlay.appendChild(status);
                body.appendChild(overlay);

                // change the title as well
                window.document.title = "(Brackets Live Preview: closed) " + window.document.title;
            },

            setDocumentObserver: function (documentOberver) {
                if (!documentOberver) {
                    return;
                }
                this._documentObserver = documentOberver;
            },

            setProtocolHandler: function (protocolHandler) {
                if (!protocolHandler) {
                    return;
                }
                this._protocolHandler = protocolHandler;
            }
        };

        // exposing ProtocolManager
        global._Brackets_LiveDev_ProtocolManager = ProtocolManager;

        /**
         * The remote handler for the protocol.
         */
        var ProtocolHandler = {
            /**
             * Handles a message from the transport. Parses it as JSON and delegates
             * to MessageBroker who is in charge of routing them to handlers.
             * @param {string} msgStr The protocol message as stringified JSON.
             */
            message: function (msgStr) {
                var msg;
                try {
                    msg = JSON.parse(msgStr);
                } catch (e) {
                    console.log("[Brackets LiveDev] Malformed message received: ", msgStr);
                    return;
                }
                // delegates handling/routing to MessageBroker.
                MessageBroker.trigger(msg);
            },

            close: function (evt) {
                ProtocolManager.onClose();
            },

            connect: function (evt) {
                ProtocolManager.onConnect();
            }
        };

        ProtocolManager.setProtocolHandler(ProtocolHandler);

        window.addEventListener('load', function () {
            ProtocolManager.enable();
        });

        /**
         * Sends the message containing tagID which is being clicked
         * to the editor in order to change the cursor position to
         * the HTML tag corresponding to the clicked element.
         */
        function onDocumentClick(event) {
            var element = event.target;
            if (element && element.hasAttribute('data-brackets-id')) {
                MessageBroker.send({
                    "tagId": element.getAttribute('data-brackets-id')
                });
            }
        }
        window.document.addEventListener("click", onDocumentClick);

    }(this)); <
/script> <
script >
    /*
     * Copyright (c) 2014 - present Adobe Systems Incorporated. All rights reserved.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a
     * copy of this software and associated documentation files (the "Software"),
     * to deal in the Software without restriction, including without limitation
     * the rights to use, copy, modify, merge, publish, distribute, sublicense,
     * and/or sell copies of the Software, and to permit persons to whom the
     * Software is furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
     * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
     * DEALINGS IN THE SOFTWARE.
     *
     */

    /*global setInterval, clearInterval */

    (function (global) {
        "use strict";

        var ProtocolManager = global._Brackets_LiveDev_ProtocolManager;

        var _document = null;
        var _transport;


        /**
         * Retrieves related documents (external CSS and JS files)
         *
         * @return {{scripts: object, stylesheets: object}} Related scripts and stylesheets
         */
        function related() {

            var rel = {
                scripts: {},
                stylesheets: {}
            };
            var i;
            // iterate on document scripts (HTMLCollection doesn't provide forEach iterator).
            for (i = 0; i < _document.scripts.length; i++) {
                // add only external scripts
                if (_document.scripts[i].src) {
                    rel.scripts[_document.scripts[i].src] = true;
                }
            }

            var s, j;
            //traverse @import rules
            var traverseRules = function _traverseRules(sheet, base) {
                var i,
                    href = sheet.href,
                    cssRules;

                // Deal with Firefox's SecurityError when accessing sheets
                // from other domains. Chrome will safely return `undefined`.
                try {
                    cssRules = sheet.cssRules;
                } catch (e) {
                    if (e.name !== "SecurityError") {
                        throw e;
                    }
                }

                if (href && cssRules) {
                    if (rel.stylesheets[href] === undefined) {
                        rel.stylesheets[href] = [];
                    }
                    rel.stylesheets[href].push(base);

                    for (i = 0; i < cssRules.length; i++) {
                        if (cssRules[i].href) {
                            traverseRules(cssRules[i].styleSheet, base);
                        }
                    }
                }
            };
            //iterate on document.stylesheets (StyleSheetList doesn't provide forEach iterator).
            for (j = 0; j < window.document.styleSheets.length; j++) {
                s = window.document.styleSheets[j];
                traverseRules(s, s.href);
            }
            return rel;
        }

        /**
         * Common functions.
         */
        var Utils = {

            isExternalStylesheet: function (node) {
                return (node.nodeName.toUpperCase() === "LINK" && node.rel === "stylesheet" && node.href);
            },
            isExternalScript: function (node) {
                return (node.nodeName.toUpperCase() === "SCRIPT" && node.src);
            }
        };

        /**
         * CSS related commands and notifications
         */
        var CSS = {

            /**
             * Maintains a map of stylesheets loaded thorugh @import rules and their parents.
             * Populated by extractImports, consumed by notifyImportsAdded / notifyImportsRemoved.
             * @type {
             */
            stylesheets: {},

            /**
             * Check the stylesheet that was just added be really loaded
             * to be able to extract potential import-ed stylesheets.
             * It invokes notifyStylesheetAdded once the sheet is loaded.
             * @param  {string} href Absolute URL of the stylesheet.
             */
            checkForStylesheetLoaded: function (href) {
                var self = this;


                // Inspect CSSRules for @imports:
                // styleSheet obejct is required to scan CSSImportRules but
                // browsers differ on the implementation of MutationObserver interface.
                // Webkit triggers notifications before stylesheets are loaded,
                // Firefox does it after loading.
                // There are also differences on when 'load' event is triggered for
                // the 'link' nodes. Webkit triggers it before stylesheet is loaded.
                // Some references to check:
                //      http://www.phpied.com/when-is-a-stylesheet-really-loaded/
                //      http://stackoverflow.com/questions/17747616/webkit-dynamically-created-stylesheet-when-does-it-really-load
                //        http://stackoverflow.com/questions/11425209/are-dom-mutation-observers-slower-than-dom-mutation-events
                //
                // TODO: This is just a temporary 'cross-browser' solution, it needs optimization.
                var loadInterval = setInterval(function () {
                    var i;
                    for (i = 0; i < window.document.styleSheets.length; i++) {
                        if (window.document.styleSheets[i].href === href) {
                            //clear interval
                            clearInterval(loadInterval);
                            // notify stylesheets added
                            self.notifyStylesheetAdded(href);
                            break;
                        }
                    }
                }, 50);
            },

            onStylesheetRemoved: function (url) {
                // get style node created when setting new text for stylesheet.
                var s = window.document.getElementById(url);
                // remove
                if (s && s.parentNode && s.parentNode.removeChild) {
                    s.parentNode.removeChild(s);
                }
            },

            /**
             * Send a notification for the stylesheet added and
             * its import-ed styleshets based on document.stylesheets diff
             * from previous status. It also updates stylesheets status.
             */
            notifyStylesheetAdded: function () {
                var added = {},
                    current,
                    newStatus;

                current = this.stylesheets;
                newStatus = related().stylesheets;

                Object.keys(newStatus).forEach(function (v, i) {
                    if (!current[v]) {
                        added[v] = newStatus[v];
                    }
                });

                Object.keys(added).forEach(function (v, i) {
                    _transport.send(JSON.stringify({
                        method: "StylesheetAdded",
                        href: v,
                        roots: [added[v]]
                    }));
                });

                this.stylesheets = newStatus;
            },

            /**
             * Send a notification for the removed stylesheet and
             * its import-ed styleshets based on document.stylesheets diff
             * from previous status. It also updates stylesheets status.
             */
            notifyStylesheetRemoved: function () {

                var self = this;
                var removed = {},
                    newStatus,
                    current;

                current = self.stylesheets;
                newStatus = related().stylesheets;

                Object.keys(current).forEach(function (v, i) {
                    if (!newStatus[v]) {
                        removed[v] = current[v];
                        // remove node created by setStylesheetText if any
                        self.onStylesheetRemoved(current[v]);
                    }
                });

                Object.keys(removed).forEach(function (v, i) {
                    _transport.send(JSON.stringify({
                        method: "StylesheetRemoved",
                        href: v,
                        roots: [removed[v]]
                    }));
                });

                self.stylesheets = newStatus;
            }
        };


        /* process related docs added */
        function _onNodesAdded(nodes) {
            var i;
            for (i = 0; i < nodes.length; i++) {
                //check for Javascript files
                if (Utils.isExternalScript(nodes[i])) {
                    _transport.send(JSON.stringify({
                        method: 'ScriptAdded',
                        src: nodes[i].src
                    }));
                }
                //check for stylesheets
                if (Utils.isExternalStylesheet(nodes[i])) {
                    CSS.checkForStylesheetLoaded(nodes[i].href);
                }
            }
        }
        /* process related docs removed */
        function _onNodesRemoved(nodes) {
            var i;
            //iterate on removed nodes
            for (i = 0; i < nodes.length; i++) {

                // check for external JS files
                if (Utils.isExternalScript(nodes[i])) {
                    _transport.send(JSON.stringify({
                        method: 'ScriptRemoved',
                        src: nodes[i].src
                    }));
                }
                //check for external StyleSheets
                if (Utils.isExternalStylesheet(nodes[i])) {
                    CSS.notifyStylesheetRemoved(nodes[i].href);
                }
            }
        }

        function _enableListeners() {
            // enable MutationOberver if it's supported
            var MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;
            if (MutationObserver) {
                var observer = new MutationObserver(function (mutations) {
                    mutations.forEach(function (mutation) {
                        if (mutation.addedNodes.length > 0) {
                            _onNodesAdded(mutation.addedNodes);
                        }
                        if (mutation.removedNodes.length > 0) {
                            _onNodesRemoved(mutation.removedNodes);
                        }
                    });
                });
                observer.observe(_document, {
                    childList: true,
                    subtree: true
                });
            } else {
                // use MutationEvents as fallback
                window.document.addEventListener('DOMNodeInserted', function niLstnr(e) {
                    _onNodesAdded([e.target]);
                });
                window.document.addEventListener('DOMNodeRemoved', function nrLstnr(e) {
                    _onNodesRemoved([e.target]);
                });
            }
        }


        /**
         * Start listening for events and send initial related documents message.
         *
         * @param {HTMLDocument} document
         * @param {object} transport Live development transport connection
         */
        function start(document, transport) {
            _transport = transport;
            _document = document;
            // start listening to node changes
            _enableListeners();

            var rel = related();

            // send the current status of related docs.
            _transport.send(JSON.stringify({
                method: "DocumentRelated",
                related: rel
            }));
            // initialize stylesheets with current status for further notifications.
            CSS.stylesheets = rel.stylesheets;
        }

        /**
         * Stop listening.
         * TODO currently a no-op.
         */
        function stop() {

        }

        var DocumentObserver = {
            start: start,
            stop: stop,
            related: related
        };

        ProtocolManager.setDocumentObserver(DocumentObserver);

    }(this));
window._LD = (
    /*
     * Copyright (c) 2012 - present Adobe Systems Incorporated. All rights reserved.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a
     * copy of this software and associated documentation files (the "Software"),
     * to deal in the Software without restriction, including without limitation
     * the rights to use, copy, modify, merge, publish, distribute, sublicense,
     * and/or sell copies of the Software, and to permit persons to whom the
     * Software is furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
     * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
     * DEALINGS IN THE SOFTWARE.
     *
     */

    /*jslint forin: true */
    /*global Node, MessageEvent */
    /*theseus instrument: false */

    /**
     * RemoteFunctions define the functions to be executed in the browser. This
     * modules should define a single function that returns an object of all
     * exported functions.
     */
    function RemoteFunctions(config, remoteWSPort) {
        "use strict";

        var experimental;
        if (!config) {
            experimental = false;
        } else {
            experimental = config.experimental;
        }
        var lastKeepAliveTime = Date.now();
        var req, timeout;
        var animateHighlight = function (time) {
            if (req) {
                window.cancelAnimationFrame(req);
                window.clearTimeout(timeout);
            }
            req = window.requestAnimationFrame(redrawHighlights);

            timeout = setTimeout(function () {
                window.cancelAnimationFrame(req);
                req = null;
            }, time * 1000);
        };

        /**
         * @type {DOMEditHandler}
         */
        var _editHandler;

        var HIGHLIGHT_CLASSNAME = "__brackets-ld-highlight",
            KEEP_ALIVE_TIMEOUT = 3000; // Keep alive timeout value, in milliseconds

        // determine whether an event should be processed for Live Development
        function _validEvent(event) {
            if (window.navigator.platform.substr(0, 3) === "Mac") {
                // Mac
                return event.metaKey;
            } else {
                // Windows
                return event.ctrlKey;
            }
        }

        // determine the color for a type
        function _typeColor(type, highlight) {
            switch (type) {
                case "html":
                    return highlight ? "#eec" : "#ffe";
                case "css":
                    return highlight ? "#cee" : "#eff";
                case "js":
                    return highlight ? "#ccf" : "#eef";
                default:
                    return highlight ? "#ddd" : "#eee";
            }
        }

        // compute the screen offset of an element
        function _screenOffset(element) {
            var elemBounds = element.getBoundingClientRect(),
                body = window.document.body,
                offsetTop,
                offsetLeft;

            if (window.getComputedStyle(body).position === "static") {
                offsetLeft = elemBounds.left + window.pageXOffset;
                offsetTop = elemBounds.top + window.pageYOffset;
            } else {
                var bodyBounds = body.getBoundingClientRect();
                offsetLeft = elemBounds.left - bodyBounds.left;
                offsetTop = elemBounds.top - bodyBounds.top;
            }
            return {
                left: offsetLeft,
                top: offsetTop
            };
        }

        // set an event on a element
        function _trigger(element, name, value, autoRemove) {
            var key = "data-ld-" + name;
            if (value !== undefined && value !== null) {
                element.setAttribute(key, value);
                if (autoRemove) {
                    window.setTimeout(element.removeAttribute.bind(element, key));
                }
            } else {
                element.removeAttribute(key);
            }
        }

        // Checks if the element is in Viewport in the client browser
        function isInViewport(element) {
            var rect = element.getBoundingClientRect();
            var html = window.document.documentElement;
            return (
                rect.top >= 0 &&
                rect.left >= 0 &&
                rect.bottom <= (window.innerHeight || html.clientHeight) &&
                rect.right <= (window.innerWidth || html.clientWidth)
            );
        }

        // returns the distance from the top of the closest relatively positioned parent element
        function getDocumentOffsetTop(element) {
            return element.offsetTop + (element.offsetParent ? getDocumentOffsetTop(element.offsetParent) : 0);
        }

        // construct the info menu
        function Menu(element) {
            this.element = element;
            _trigger(this.element, "showgoto", 1, true);
            window.setTimeout(window.remoteShowGoto);
            this.remove = this.remove.bind(this);
        }

        Menu.prototype = {
            onClick: function (url, event) {
                event.preventDefault();
                _trigger(this.element, "goto", url, true);
                this.remove();
            },

            createBody: function () {
                if (this.body) {
                    return;
                }

                // compute the position on screen
                var offset = _screenOffset(this.element),
                    x = offset.left,
                    y = offset.top + this.element.offsetHeight;

                // create the container
                this.body = window.document.createElement("div");
                this.body.style.setProperty("z-index", 2147483647);
                this.body.style.setProperty("position", "absolute");
                this.body.style.setProperty("left", x + "px");
                this.body.style.setProperty("top", y + "px");
                this.body.style.setProperty("font-size", "11pt");

                // draw the background
                this.body.style.setProperty("background", "#fff");
                this.body.style.setProperty("border", "1px solid #888");
                this.body.style.setProperty("-webkit-box-shadow", "2px 2px 6px 0px #ccc");
                this.body.style.setProperty("border-radius", "6px");
                this.body.style.setProperty("padding", "6px");
            },

            addItem: function (target) {
                var item = window.document.createElement("div");
                item.style.setProperty("padding", "2px 6px");
                if (this.body.childNodes.length > 0) {
                    item.style.setProperty("border-top", "1px solid #ccc");
                }
                item.style.setProperty("cursor", "pointer");
                item.style.setProperty("background", _typeColor(target.type));
                item.innerHTML = target.name;
                item.addEventListener("click", this.onClick.bind(this, target.url));

                if (target.file) {
                    var file = window.document.createElement("i");
                    file.style.setProperty("float", "right");
                    file.style.setProperty("margin-left", "12px");
                    file.innerHTML = " " + target.file;
                    item.appendChild(file);
                }
                this.body.appendChild(item);
            },

            show: function () {
                if (!this.body) {
                    this.body = this.createBody();
                }
                if (!this.body.parentNode) {
                    window.document.body.appendChild(this.body);
                }
                window.document.addEventListener("click", this.remove);
            },

            remove: function () {
                if (this.body && this.body.parentNode) {
                    window.document.body.removeChild(this.body);
                }
                window.document.removeEventListener("click", this.remove);
            }

        };

        function Editor(element) {
            this.onBlur = this.onBlur.bind(this);
            this.onKeyPress = this.onKeyPress.bind(this);

            this.element = element;
            this.element.setAttribute("contenteditable", "true");
            this.element.focus();
            this.element.addEventListener("blur", this.onBlur);
            this.element.addEventListener("keypress", this.onKeyPress);

            this.revertText = this.element.innerHTML;

            _trigger(this.element, "edit", 1);
        }

        Editor.prototype = {
            onBlur: function (event) {
                this.element.removeAttribute("contenteditable");
                this.element.removeEventListener("blur", this.onBlur);
                this.element.removeEventListener("keypress", this.onKeyPress);
                _trigger(this.element, "edit", 0, true);
            },

            onKeyPress: function (event) {
                switch (event.which) {
                    case 13: // return
                        this.element.blur();
                        break;
                    case 27: // esc
                        this.element.innerHTML = this.revertText;
                        this.element.blur();
                        break;
                }
            }
        };

        function Highlight(color, trigger) {
            this.color = color;
            this.trigger = !!trigger;
            this.elements = [];
            this.selector = "";
        }

        Highlight.prototype = {
            _elementExists: function (element) {
                var i;
                for (i in this.elements) {
                    if (this.elements[i] === element) {
                        return true;
                    }
                }
                return false;
            },
            _makeHighlightDiv: function (element, doAnimation) {
                var elementBounds = element.getBoundingClientRect(),
                    highlight = window.document.createElement("div"),
                    elementStyling = window.getComputedStyle(element),
                    transitionDuration = parseFloat(elementStyling.getPropertyValue('transition-duration')),
                    animationDuration = parseFloat(elementStyling.getPropertyValue('animation-duration'));

                if (transitionDuration) {
                    animateHighlight(transitionDuration);
                }

                if (animationDuration) {
                    animateHighlight(animationDuration);
                }

                // Don't highlight elements with 0 width & height
                if (elementBounds.width === 0 && elementBounds.height === 0) {
                    return;
                }

                var realElBorder = {
                    right: elementStyling.getPropertyValue('border-right-width'),
                    left: elementStyling.getPropertyValue('border-left-width'),
                    top: elementStyling.getPropertyValue('border-top-width'),
                    bottom: elementStyling.getPropertyValue('border-bottom-width')
                };

                var borderBox = elementStyling.boxSizing === 'border-box';

                var innerWidth = parseFloat(elementStyling.width),
                    innerHeight = parseFloat(elementStyling.height),
                    outerHeight = innerHeight,
                    outerWidth = innerWidth;

                if (!borderBox) {
                    innerWidth += parseFloat(elementStyling.paddingLeft) + parseFloat(elementStyling.paddingRight);
                    innerHeight += parseFloat(elementStyling.paddingTop) + parseFloat(elementStyling.paddingBottom);
                    outerWidth = innerWidth + parseFloat(realElBorder.right) +
                        parseFloat(realElBorder.left),
                        outerHeight = innerHeight + parseFloat(realElBorder.bottom) + parseFloat(realElBorder.top);
                }


                var visualisations = {
                    horizontal: "left, right",
                    vertical: "top, bottom"
                };

                var drawPaddingRect = function (side) {
                    var elStyling = {};

                    if (visualisations.horizontal.indexOf(side) >= 0) {
                        elStyling['width'] = elementStyling.getPropertyValue('padding-' + side);
                        elStyling['height'] = innerHeight + "px";
                        elStyling['top'] = 0;

                        if (borderBox) {
                            elStyling['height'] = innerHeight - parseFloat(realElBorder.top) - parseFloat(realElBorder.bottom) + "px";
                        }

                    } else {
                        elStyling['height'] = elementStyling.getPropertyValue('padding-' + side);
                        elStyling['width'] = innerWidth + "px";
                        elStyling['left'] = 0;

                        if (borderBox) {
                            elStyling['width'] = innerWidth - parseFloat(realElBorder.left) - parseFloat(realElBorder.right) + "px";
                        }
                    }

                    elStyling[side] = 0;
                    elStyling['position'] = 'absolute';

                    return elStyling;
                };

                var drawMarginRect = function (side) {
                    var elStyling = {};

                    var margin = [];
                    margin['right'] = parseFloat(elementStyling.getPropertyValue('margin-right'));
                    margin['top'] = parseFloat(elementStyling.getPropertyValue('margin-top'));
                    margin['bottom'] = parseFloat(elementStyling.getPropertyValue('margin-bottom'));
                    margin['left'] = parseFloat(elementStyling.getPropertyValue('margin-left'));

                    if (visualisations['horizontal'].indexOf(side) >= 0) {

                        elStyling['width'] = elementStyling.getPropertyValue('margin-' + side);
                        elStyling['height'] = outerHeight + margin['top'] + margin['bottom'] + "px";
                        elStyling['top'] = "-" + (margin['top'] + parseFloat(realElBorder.top)) + "px";
                    } else {
                        elStyling['height'] = elementStyling.getPropertyValue('margin-' + side);
                        elStyling['width'] = outerWidth + "px";
                        elStyling['left'] = "-" + realElBorder.left;
                    }

                    elStyling[side] = "-" + (margin[side] + parseFloat(realElBorder[side])) + "px";
                    elStyling['position'] = 'absolute';

                    return elStyling;
                };

                var setVisibility = function (el) {
                    if (
                        !config.remoteHighlight.showPaddingMargin ||
                        parseInt(el.height, 10) <= 0 ||
                        parseInt(el.width, 10) <= 0
                    ) {
                        el.display = 'none';
                    } else {
                        el.display = 'block';
                    }
                };

                var mainBoxStyles = config.remoteHighlight.stylesToSet;

                var paddingVisualisations = [
              drawPaddingRect('top'),
              drawPaddingRect('right'),
              drawPaddingRect('bottom'),
              drawPaddingRect('left')
            ];

                var marginVisualisations = [
              drawMarginRect('top'),
              drawMarginRect('right'),
              drawMarginRect('bottom'),
              drawMarginRect('left')
            ];

                var setupVisualisations = function (arr, config) {
                    var i;
                    for (i = 0; i < arr.length; i++) {
                        setVisibility(arr[i]);

                        // Applies to every visualisationElement (padding or margin div)
                        arr[i]["transform"] = "none";
                        var el = window.document.createElement("div"),
                            styles = Object.assign({},
                                config,
                                arr[i]
                            );

                        _setStyleValues(styles, el.style);

                        highlight.appendChild(el);
                    }
                };

                setupVisualisations(
                    marginVisualisations,
                    config.remoteHighlight.marginStyling
                );
                setupVisualisations(
                    paddingVisualisations,
                    config.remoteHighlight.paddingStyling
                );

                highlight.className = HIGHLIGHT_CLASSNAME;

                var offset = _screenOffset(element);

                var el = element,
                    offsetLeft = 0,
                    offsetTop = 0;

                // Probably the easiest way to get elements position without including transform		
                do {
                    offsetLeft += el.offsetLeft;
                    offsetTop += el.offsetTop;
                    el = el.offsetParent;
                } while (el);

                var stylesToSet = {
                    "left": offsetLeft + "px",
                    "top": offsetTop + "px",
                    "width": innerWidth + "px",
                    "height": innerHeight + "px",
                    "z-index": 2000000,
                    "margin": 0,
                    "padding": 0,
                    "position": "absolute",
                    "pointer-events": "none",
                    "box-shadow": "0 0 1px #fff",
                    "box-sizing": elementStyling.getPropertyValue('box-sizing'),
                    "border-right": elementStyling.getPropertyValue('border-right'),
                    "border-left": elementStyling.getPropertyValue('border-left'),
                    "border-top": elementStyling.getPropertyValue('border-top'),
                    "border-bottom": elementStyling.getPropertyValue('border-bottom'),
                    "transform": elementStyling.getPropertyValue('transform'),
                    "transform-origin": elementStyling.getPropertyValue('transform-origin'),
                    "border-color": config.remoteHighlight.borderColor
                };

                var mergedStyles = Object.assign({}, stylesToSet, config.remoteHighlight.stylesToSet);

                var animateStartValues = config.remoteHighlight.animateStartValue;

                var animateEndValues = config.remoteHighlight.animateEndValue;

                var transitionValues = {
                    "transition-property": "opacity, background-color, transform",
                    "transition-duration": "300ms, 2.3s"
                };

                function _setStyleValues(styleValues, obj) {
                    var prop;

                    for (prop in styleValues) {
                        obj.setProperty(prop, styleValues[prop]);
                    }
                }

                _setStyleValues(mergedStyles, highlight.style);
                _setStyleValues(
                    doAnimation ? animateStartValues : animateEndValues,
                    highlight.style
                );


                if (doAnimation) {
                    _setStyleValues(transitionValues, highlight.style);

                    window.setTimeout(function () {
                        _setStyleValues(animateEndValues, highlight.style);
                    }, 20);
                }

                window.document.body.appendChild(highlight);
            },

            add: function (element, doAnimation) {
                if (this._elementExists(element) || element === window.document) {
                    return;
                }
                if (this.trigger) {
                    _trigger(element, "highlight", 1);
                }

                if ((!window.event || window.event instanceof MessageEvent) && !isInViewport(element)) {
                    var top = getDocumentOffsetTop(element);
                    if (top) {
                        top -= (window.innerHeight / 2);
                        window.scrollTo(0, top);
                    }
                }
                this.elements.push(element);

                this._makeHighlightDiv(element, doAnimation);
            },

            clear: function () {
                var i, highlights = window.document.querySelectorAll("." + HIGHLIGHT_CLASSNAME),
                    body = window.document.body;

                for (i = 0; i < highlights.length; i++) {
                    body.removeChild(highlights[i]);
                }

                if (this.trigger) {
                    for (i = 0; i < this.elements.length; i++) {
                        _trigger(this.elements[i], "highlight", 0);
                    }
                }

                this.elements = [];
            },

            redraw: function () {
                var i, highlighted;

                // When redrawing a selector-based highlight, run a new selector
                // query to ensure we have the latest set of elements to highlight.
                if (this.selector) {
                    highlighted = window.document.querySelectorAll(this.selector);
                } else {
                    highlighted = this.elements.slice(0);
                }

                this.clear();
                for (i = 0; i < highlighted.length; i++) {
                    this.add(highlighted[i], false);
                }
            }
        };

        var _currentEditor;

        function _toggleEditor(element) {
            _currentEditor = new Editor(element);
        }

        var _currentMenu;

        function _toggleMenu(element) {
            if (_currentMenu) {
                _currentMenu.remove();
            }
            _currentMenu = new Menu(element);
        }

        var _localHighlight;
        var _remoteHighlight;
        var _setup = false;


        /** Event Handlers ***********************************************************/

        function onMouseOver(event) {
            if (_validEvent(event)) {
                _localHighlight.add(event.target, true);
            }
        }

        function onMouseOut(event) {
            if (_validEvent(event)) {
                _localHighlight.clear();
            }
        }

        function onMouseMove(event) {
            onMouseOver(event);
            window.document.removeEventListener("mousemove", onMouseMove);
        }

        function onClick(event) {
            if (_validEvent(event)) {
                event.preventDefault();
                event.stopPropagation();
                if (event.altKey) {
                    _toggleEditor(event.target);
                } else {
                    _toggleMenu(event.target);
                }
            }
        }

        function onKeyUp(event) {
            if (_setup && !_validEvent(event)) {
                window.document.removeEventListener("keyup", onKeyUp);
                window.document.removeEventListener("mouseover", onMouseOver);
                window.document.removeEventListener("mouseout", onMouseOut);
                window.document.removeEventListener("mousemove", onMouseMove);
                window.document.removeEventListener("click", onClick);
                _localHighlight.clear();
                _localHighlight = undefined;
                _setup = false;
            }
        }

        function onKeyDown(event) {
            if (!_setup && _validEvent(event)) {
                window.document.addEventListener("keyup", onKeyUp);
                window.document.addEventListener("mouseover", onMouseOver);
                window.document.addEventListener("mouseout", onMouseOut);
                window.document.addEventListener("mousemove", onMouseMove);
                window.document.addEventListener("click", onClick);
                _localHighlight = new Highlight("#ecc", true);
                _setup = true;
            }
        }

        /** Public Commands **********************************************************/

        // keep alive. Called once a second when a Live Development connection is active.
        // If several seconds have passed without this method being called, we can assume
        // that the connection has been severed and we should remove all our code/hooks.
        function keepAlive() {
            lastKeepAliveTime = Date.now();
        }

        // show goto
        function showGoto(targets) {
            if (!_currentMenu) {
                return;
            }
            _currentMenu.createBody();
            var i;
            for (i in targets) {
                _currentMenu.addItem(targets[i]);
            }
            _currentMenu.show();
        }

        // remove active highlights
        function hideHighlight() {
            if (_remoteHighlight) {
                _remoteHighlight.clear();
                _remoteHighlight = null;
            }
        }

        // highlight a node
        function highlight(node, clear) {
            if (!_remoteHighlight) {
                _remoteHighlight = new Highlight("#cfc");
            }
            if (clear) {
                _remoteHighlight.clear();
            }
            _remoteHighlight.add(node, true);
        }

        // highlight a rule
        function highlightRule(rule) {
            hideHighlight();
            var i, nodes = window.document.querySelectorAll(rule);
            for (i = 0; i < nodes.length; i++) {
                highlight(nodes[i]);
            }
            _remoteHighlight.selector = rule;
        }

        // redraw active highlights
        function redrawHighlights() {
            if (_remoteHighlight) {
                _remoteHighlight.redraw();
            }
        }

        window.addEventListener("resize", redrawHighlights);
        // Add a capture-phase scroll listener to update highlights when
        // any element scrolls.

        function _scrollHandler(e) {
            // Document scrolls can be updated immediately. Any other scrolls
            // need to be updated on a timer to ensure the layout is correct.
            if (e.target === window.document) {
                redrawHighlights();
            } else {
                if (_remoteHighlight || _localHighlight) {
                    window.setTimeout(redrawHighlights, 0);
                }
            }
        }

        window.addEventListener("scroll", _scrollHandler, true);

        var aliveTest = window.setInterval(function () {
            if (Date.now() > lastKeepAliveTime + KEEP_ALIVE_TIMEOUT) {
                // Remove highlights
                hideHighlight();

                // Remove listeners
                window.removeEventListener("resize", redrawHighlights);
                window.removeEventListener("scroll", _scrollHandler, true);

                // Clear this interval
                window.clearInterval(aliveTest);
            }
        }, 1000);

        /**
         * Constructor
         * @param {Document} htmlDocument
         */
        function DOMEditHandler(htmlDocument) {
            this.htmlDocument = htmlDocument;
            this.rememberedNodes = null;
            this.entityParseParent = htmlDocument.createElement("div");
        }

        /**
         * @private
         * Find the first matching element with the specified data-brackets-id
         * @param {string} id
         * @return {Element}
         */
        DOMEditHandler.prototype._queryBracketsID = function (id) {
            if (!id) {
                return null;
            }

            if (this.rememberedNodes && this.rememberedNodes[id]) {
                return this.rememberedNodes[id];
            }

            var results = this.htmlDocument.querySelectorAll("[data-brackets-id='" + id + "']");
            return results && results[0];
        };

        /**
         * @private
         * Insert a new child element
         * @param {Element} targetElement Parent element already in the document
         * @param {Element} childElement New child element
         * @param {Object} edit
         */
        DOMEditHandler.prototype._insertChildNode = function (targetElement, childElement, edit) {
            var before = this._queryBracketsID(edit.beforeID),
                after = this._queryBracketsID(edit.afterID);

            if (edit.firstChild) {
                before = targetElement.firstChild;
            } else if (edit.lastChild) {
                after = targetElement.lastChild;
            }

            if (before) {
                targetElement.insertBefore(childElement, before);
            } else if (after && (after !== targetElement.lastChild)) {
                targetElement.insertBefore(childElement, after.nextSibling);
            } else {
                targetElement.appendChild(childElement);
            }
        };

        /**
         * @private
         * Given a string containing encoded entity references, returns the string with the entities decoded.
         * @param {string} text The text to parse.
         * @return {string} The decoded text.
         */
        DOMEditHandler.prototype._parseEntities = function (text) {
            // Kind of a hack: just set the innerHTML of a div to the text, which will parse the entities, then
            // read the content out.
            var result;
            this.entityParseParent.innerHTML = text;
            result = this.entityParseParent.textContent;
            this.entityParseParent.textContent = "";
            return result;
        };

        /**
         * @private
         * @param {Node} node
         * @return {boolean} true if node expects its content to be raw text (not parsed for entities) according to the HTML5 spec.
         */
        function _isRawTextNode(node) {
            return (node.nodeType === Node.ELEMENT_NODE && /script|style|noscript|noframes|noembed|iframe|xmp/i.test(node.tagName));
        }

        /**
         * @private
         * Replace a range of text and comment nodes with an optional new text node
         * @param {Element} targetElement
         * @param {Object} edit
         */
        DOMEditHandler.prototype._textReplace = function (targetElement, edit) {
            function prevIgnoringHighlights(node) {
                do {
                    node = node.previousSibling;
                } while (node && node.className === HIGHLIGHT_CLASSNAME);
                return node;
            }

            function nextIgnoringHighlights(node) {
                do {
                    node = node.nextSibling;
                } while (node && node.className === HIGHLIGHT_CLASSNAME);
                return node;
            }

            function lastChildIgnoringHighlights(node) {
                node = (node.childNodes.length ? node.childNodes.item(node.childNodes.length - 1) : null);
                if (node && node.className === HIGHLIGHT_CLASSNAME) {
                    node = prevIgnoringHighlights(node);
                }
                return node;
            }

            var start = (edit.afterID) ? this._queryBracketsID(edit.afterID) : null,
                startMissing = edit.afterID && !start,
                end = (edit.beforeID) ? this._queryBracketsID(edit.beforeID) : null,
                endMissing = edit.beforeID && !end,
                moveNext = start && nextIgnoringHighlights(start),
                current = moveNext || (end && prevIgnoringHighlights(end)) || lastChildIgnoringHighlights(targetElement),
                next,
                textNode = (edit.content !== undefined) ? this.htmlDocument.createTextNode(_isRawTextNode(targetElement) ? edit.content : this._parseEntities(edit.content)) : null,
                lastRemovedWasText,
                isText;

            // remove all nodes inside the range
            while (current && (current !== end)) {
                isText = current.nodeType === Node.TEXT_NODE;

                // if start is defined, delete following text nodes
                // if start is not defined, delete preceding text nodes
                next = (moveNext) ? nextIgnoringHighlights(current) : prevIgnoringHighlights(current);

                // only delete up to the nearest element.
                // if the start/end tag was deleted in a prior edit, stop removing
                // nodes when we hit adjacent text nodes
                if ((current.nodeType === Node.ELEMENT_NODE) ||
                    ((startMissing || endMissing) && (isText && lastRemovedWasText))) {
                    break;
                } else {
                    lastRemovedWasText = isText;

                    if (current.remove) {
                        current.remove();
                    } else if (current.parentNode && current.parentNode.removeChild) {
                        current.parentNode.removeChild(current);
                    }
                    current = next;
                }
            }

            if (textNode) {
                // OK to use nextSibling here (not nextIgnoringHighlights) because we do literally
                // want to insert immediately after the start tag.
                if (start && start.nextSibling) {
                    targetElement.insertBefore(textNode, start.nextSibling);
                } else if (end) {
                    targetElement.insertBefore(textNode, end);
                } else {
                    targetElement.appendChild(textNode);
                }
            }
        };

        /**
         * @private
         * Apply an array of DOM edits to the document
         * @param {Array.<Object>} edits
         */
        DOMEditHandler.prototype.apply = function (edits) {
            var targetID,
                targetElement,
                childElement,
                self = this;

            this.rememberedNodes = {};

            edits.forEach(function (edit) {
                var editIsSpecialTag = edit.type === "elementInsert" && (edit.tag === "html" || edit.tag === "head" || edit.tag === "body");

                if (edit.type === "rememberNodes") {
                    edit.tagIDs.forEach(function (tagID) {
                        var node = self._queryBracketsID(tagID);
                        self.rememberedNodes[tagID] = node;
                        if (node.remove) {
                            node.remove();
                        } else if (node.parentNode && node.parentNode.removeChild) {
                            node.parentNode.removeChild(node);
                        }
                    });
                    return;
                }

                targetID = edit.type.match(/textReplace|textDelete|textInsert|elementInsert|elementMove/) ? edit.parentID : edit.tagID;
                targetElement = self._queryBracketsID(targetID);

                if (!targetElement && !editIsSpecialTag) {
                    console.error("data-brackets-id=" + targetID + " not found");
                    return;
                }

                switch (edit.type) {
                    case "attrChange":
                    case "attrAdd":
                        targetElement.setAttribute(edit.attribute, self._parseEntities(edit.value));
                        break;
                    case "attrDelete":
                        targetElement.removeAttribute(edit.attribute);
                        break;
                    case "elementDelete":
                        if (targetElement.remove) {
                            targetElement.remove();
                        } else if (targetElement.parentNode && targetElement.parentNode.removeChild) {
                            targetElement.parentNode.removeChild(targetElement);
                        }
                        break;
                    case "elementInsert":
                        childElement = null;
                        if (editIsSpecialTag) {
                            // If we already have one of these elements (which we should), then
                            // just copy the attributes and set the ID.
                            childElement = self.htmlDocument[edit.tag === "html" ? "documentElement" : edit.tag];
                            if (!childElement) {
                                // Treat this as a normal insertion.
                                editIsSpecialTag = false;
                            }
                        }
                        if (!editIsSpecialTag) {
                            childElement = self.htmlDocument.createElement(edit.tag);
                        }

                        Object.keys(edit.attributes).forEach(function (attr) {
                            childElement.setAttribute(attr, self._parseEntities(edit.attributes[attr]));
                        });
                        childElement.setAttribute("data-brackets-id", edit.tagID);

                        if (!editIsSpecialTag) {
                            self._insertChildNode(targetElement, childElement, edit);
                        }
                        break;
                    case "elementMove":
                        childElement = self._queryBracketsID(edit.tagID);
                        self._insertChildNode(targetElement, childElement, edit);
                        break;
                    case "textInsert":
                        var textElement = self.htmlDocument.createTextNode(_isRawTextNode(targetElement) ? edit.content : self._parseEntities(edit.content));
                        self._insertChildNode(targetElement, textElement, edit);
                        break;
                    case "textReplace":
                    case "textDelete":
                        self._textReplace(targetElement, edit);
                        break;
                }
            });

            this.rememberedNodes = {};

            // update highlight after applying diffs
            redrawHighlights();
        };

        function applyDOMEdits(edits) {
            _editHandler.apply(edits);
        }

        /**
         *
         * @param {Element} elem
         */
        function _domElementToJSON(elem) {
            var json = {
                    tag: elem.tagName.toLowerCase(),
                    attributes: {},
                    children: []
                },
                i,
                len,
                node,
                value;

            len = elem.attributes.length;
            for (i = 0; i < len; i++) {
                node = elem.attributes.item(i);
                value = (node.name === "data-brackets-id") ? parseInt(node.value, 10) : node.value;
                json.attributes[node.name] = value;
            }

            len = elem.childNodes.length;
            for (i = 0; i < len; i++) {
                node = elem.childNodes.item(i);

                // ignores comment nodes and visuals generated by live preview
                if (node.nodeType === Node.ELEMENT_NODE && node.className !== HIGHLIGHT_CLASSNAME) {
                    json.children.push(_domElementToJSON(node));
                } else if (node.nodeType === Node.TEXT_NODE) {
                    json.children.push({
                        content: node.nodeValue
                    });
                }
            }

            return json;
        }

        function getSimpleDOM() {
            return JSON.stringify(_domElementToJSON(window.document.documentElement));
        }

        function updateConfig(newConfig) {
            config = JSON.parse(newConfig);
            return JSON.stringify(config);
        }

        // init
        _editHandler = new DOMEditHandler(window.document);

        if (experimental) {
            window.document.addEventListener("keydown", onKeyDown);
        }

        var _ws = null;

        function onDocumentClick(event) {
            var element = event.target,
                currentDataId,
                newDataId;

            if (_ws && element && element.hasAttribute('data-brackets-id')) {
                _ws.send(JSON.stringify({
                    type: "message",
                    message: element.getAttribute('data-brackets-id')
                }));
            }
        }


        function createWebSocket() {
            _ws = new WebSocket("ws://localhost:" + remoteWSPort);
            _ws.onopen = function () {
                window.document.addEventListener("click", onDocumentClick);
            };

            _ws.onmessage = function (evt) {};

            _ws.onclose = function () {
                // websocket is closed
                window.document.removeEventListener("click", onDocumentClick);
            };
        }

        if (remoteWSPort) {
            createWebSocket();
        }

        return {
            "DOMEditHandler": DOMEditHandler,
            "keepAlive": keepAlive,
            "showGoto": showGoto,
            "hideHighlight": hideHighlight,
            "highlight": highlight,
            "highlightRule": highlightRule,
            "redrawHighlights": redrawHighlights,
            "applyDOMEdits": applyDOMEdits,
            "getSimpleDOM": getSimpleDOM,
            "updateConfig": updateConfig
        };
    }
    ({
        "experimental": false,
        "debug": true,
        "autoconnect": false,
        "highlight": true,
        "highlightConfig": {
            "borderColor": {
                "r": 255,
                "g": 229,
                "b": 153,
                "a": 0.66
            },
            "contentColor": {
                "r": 111,
                "g": 168,
                "b": 220,
                "a": 0.55
            },
            "marginColor": {
                "r": 246,
                "g": 178,
                "b": 107,
                "a": 0.66
            },
            "paddingColor": {
                "r": 147,
                "g": 196,
                "b": 125,
                "a": 0.66
            },
            "showInfo": true
        },
        "remoteHighlight": {
            "animateStartValue": {
                "background-color": "rgba(0, 162, 255, 0.5)",
                "opacity": 0
            },
            "animateEndValue": {
                "background-color": "rgba(0, 162, 255, 0)",
                "opacity": 0.6
            },
            "paddingStyling": {
                "border-width": "1px",
                "border-style": "dashed",
                "border-color": "rgba(0, 162, 255, 0.5)"
            },
            "marginStyling": {
                "background-color": "rgba(21, 165, 255, 0.58)"
            },
            "borderColor": "rgba(21, 165, 255, 0.85)",
            "showPaddingMargin": true
        }
    }))
