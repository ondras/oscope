var O = {};

O.Display = function(options) {
	this._options = Object.assign({
		pixelsPerSample: 1,
		multiMode: "overlay", // "overlay", "scale", "xy"
	}, options);

	this._inputs = [];
	this._ctx = document.createElement("canvas").getContext("2d");
	this._fps = {
		time: 0,
		node: document.createElement("div"),
		count: 0
	}
	this._fps.node.id = "fps";

	this._frame = null;
	this._tick = this._tick.bind(this);
}

Object.assign(O.Display.prototype, {
	getNode: function() {
		return this._ctx.canvas;
	},
	
	getFPS: function() {
		return this._fps.node;
	},

	addInput: function(input) {
		this._inputs.push(input);
		return this;
	},
	
	clearInputs: function() {
		this._inputs = [];
	},

	configure: function(options) {
		Object.assign(this._options, options);
		return this;
	},

	start: function() {
		if (!this._frame) {
			this._frame = requestAnimationFrame(this._tick);
		}
		return this;
	},

	stop: function() {
		if (this._frame) {
			cancelAnimationFrame(this._frame);
			this._frame = null;
		}
		return this;
	},

	_tick: function() {
		this._frame = requestAnimationFrame(this._tick);
		
		this._fps.count++;
		if (this._fps.count == 10) {
			var now = performance.now();
			this._fps.node.innerHTML = ~~(1000 * this._fps.count / (now-this._fps.time));
			this._fps.count = 0;
			this._fps.time = now;
		}

		this._draw();
	},

	_draw: function() {
		var canvas = this._ctx.canvas;
		var samples = Math.floor(Math.max(canvas.width, canvas.height) / this._options.pixelsPerSample);
		var values = this._inputs.map(function(input) { return input.getData(samples); });
	
		if (canvas.width != canvas.clientWidth || canvas.height != canvas.clientHeight) {
			canvas.width = canvas.clientWidth;
			canvas.height = canvas.clientHeight;
		} else {
			this._ctx.clearRect(0, 0, canvas.width, canvas.height);
		}

		if (values.length == 1) {
			this._drawWave(values[0], 0);
		} else if (values.length > 1) {
			switch (this._options.multiMode) {
				case "xy":
					this._drawXY(values[0], values[1]);
				break;
				
				case "overlay":
				case "scale":
					values.forEach(this._drawWave, this);
				break;
			}
		}
	},
	
	_drawXY: function(valuesX, valuesY) {
		var c = this._ctx;
		var o = this._options;

		this._inputs[0].applyStyle(c);

		c.beginPath();

		var scaleX = c.canvas.width / 2;
		var offsetX = scaleX;
		var scaleY = c.canvas.height / 2;
		var offsetY = scaleY;

		valuesX.forEach(function(value, index) {
			var x = offsetX + valuesX[index] * scaleX;
			var y = offsetY - valuesY[index] * scaleY;
			if (index) {
				c.lineTo(x, y);
			} else {
				c.moveTo(x, y);
			}
		});

		c.stroke();
	},

	_drawWave: function(values, index) {
		var c = this._ctx;
		var o = this._options;
		this._inputs[index].applyStyle(c);

		c.beginPath();

		var scaleX = c.canvas.width / (values.length-1);
		var scaleY = c.canvas.height / 2;
		var offsetY = scaleY;
		
		if (o.multiMode == "scale") {
			scaleY *= 1/this._inputs.length;
			offsetY = 2 * scaleY * (index+0.5);
		}

		values.forEach(function(value, index) {
			var x = index * scaleX;
			var y = offsetY - value * scaleY;
			if (index) {
				c.lineTo(x, y);
			} else {
				c.moveTo(x, y);
			}
		});

		c.stroke();
	}
});

O.Input = function(options) {
	this._options = Object.assign(this._defaultOptions(), options);
}

Object.assign(O.Input.prototype, {
	_defaultOptions: function() {
		return {
			color: "#80ffff",
			shadow: "#fff",
			lineWidth: 4,
			scale: 0.9
		};
	},

	configure: function(options) {
		Object.assign(this._options, options);
		return this;
	},

	getOptions: function() {
		return this._options;
	},

	getData: function(samples) {
		return new Array(samples).fill(0);
	},

	applyStyle: function(context) {
		var o = this._options;
		context.lineWidth = o.lineWidth;
		context.strokeStyle = context.shadowColor = o.color;

		if (o.shadow) {
			context.shadowBlur = o.lineWidth;
		} else {
			context.shadowBlur = 0;
		}
	}
});

O.MathInput = function(func, options) {
	O.Input.call(this, options);
	this._func = func;
}
Object.assign(O.MathInput.prototype, O.Input.prototype, {
	getData: function(samples) {
		var results = [];
		var t = performance.now();
		var scale = this._options.scale;
		for (var i=0;i<samples;i++) {
			results.push(this._func(i/(samples-1), t) * scale);
		}
		return results;
	}
});

O.WebAudioInput = function(audioContext, options) {
	O.Input.call(this, options);
	this._analyser = audioContext.createAnalyser();
	this._analyser.fftSize = this._options.fftSize;
	this._analyser.smoothingTimeConstant = 1;
	this._data = new Float32Array(this._analyser.frequencyBinCount);
}

Object.assign(O.WebAudioInput.prototype, O.Input.prototype, {
	_defaultOptions: function() {
		return Object.assign(O.Input.prototype._defaultOptions(), {
			stabilize: false,
			fftSize: 2048
		});
	},

	getAudioNode: function() {
		return this._analyser;
	},

	getData: function(samples) {
		this._analyser.getFloatTimeDomainData(this._data);
		var scale = this._options.scale;
		var results = [];
		
		var start = 0;
		if (this._options.stabilize) {
			/* start with a positive zero crossing */
			start = this._findZeroCrossing(this._data.length-samples);
		}
		
		var count = Math.min(samples, this._data.length);

		for (var i=0;i<samples;i++) {
			results.push(this._data[start+i] * scale);
		}

		return results;
	},
	
	_findZeroCrossing: function(limit) {
		var index = -1;
		for (var i=0;i<limit;i++) {
			var val = this._data[i];
			if (val < 0) { index = i; }
			if (val >= 0 && index > -1) { return i; }
		}
		return 0;
	}

});
