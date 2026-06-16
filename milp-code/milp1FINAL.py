import numpy as np
from pulp import *

def milp1(numberOFjunctions, t, delta, r, tao, cycle):
  # Build the model
  maxband = LpProblem("MILP1", LpMaximize)

  # Assign the input (array)
  t = np.array(t)
  delta = np.array(delta)
  r = np.array(r)
  tao = np.array(tao)

  # Add variables
  b = LpVariable("b", 0, 1)  # 0<=b<=1
  w = [[LpVariable(f"w_{i}_{j}", 0, 1) for j in range(numberOFjunctions)] for i in range(2)]  # 0<=w<=1
  m = [LpVariable(f"m_{i}", 0, None, LpInteger) for i in range(numberOFjunctions)]  # m = integer >= 0

  # Set objective function
  maxband += b

  # Add constraints
  # ***Constraint 1
  for i in range(numberOFjunctions):
      maxband += w[0][i] + b <= 1 - r[0, i], f"con1_out_{i}"
  for i in range(numberOFjunctions):
      maxband += w[1][i] + b <= 1 - r[1, i], f"con1_in_{i}"

  # ***Constraint 2
  for i in range(numberOFjunctions-1):
      maxband += (t[0,i] + t[1,i] + w[0][i] + w[1][i] - w[0][i+1] - w[1][i+1] + delta[i] - delta[i+1]
              == - 0.5 * (r[1,i] + r[0,i]) + 0.5 * (r[1,i+1] + r[0,i+1]) + tao[0,i+1] + tao[1,i] + m[i]), f"con2_{i}"

  # Solve with HiGHS
  solver = HiGHS(msg=False)
  maxband.solve(solver)

  # Calculate internode offset
  b_max = value(b)
  w_sol = np.empty((2, numberOFjunctions), dtype=float)
  phi = np.empty((2, numberOFjunctions-1), dtype=float)
  offset = np.empty((numberOFjunctions-1), dtype=int)

  for i in range(numberOFjunctions):
    w_sol[0,i] = value(w[0][i])
    w_sol[1,i] = value(w[1][i])

  for i in range(numberOFjunctions-1):
    phi[0, i]=0.5*r[0, i] + w_sol[0, i] + t[0, i]-  0.5*r[0, i+1] - w_sol [0, i+1] - tao[0,i+1]
    phi[1, i]=0.5 * r[1, i] + w_sol[1, i] + t[1, i] - 0.5 * r[1, i+1] - w_sol [1, i] - tao [1, i]

  for i in range(numberOFjunctions-1):
    if i == 0:
      offset[i] = round((phi[0, i] - 0.5 * (1- r[0, i+1]) + 0.5 * (1-r[0, i]))*cycle)
    else:
      offset[i] = round((phi[0, i] - 0.5 * (1 - r[0, i+1]) + 0.5 * (1-r[0, i]))*cycle + offset[i - 1])

  # Convert solution into dictionary
  output = {}
  output["b_max"] = round(b_max * cycle)
  output["b[0]"] = round(value(b), 4)
  for i in range(2):
      for j in range(numberOFjunctions):
          output[f"w[{i},{j}]"] = round(value(w[i][j]), 4)
  for i in range(numberOFjunctions):
      output[f"m[{i}]"] = round(value(m[i]), 4)

  for i in range(numberOFjunctions-1):
    output["Outbound_phi_" + str(i)] = round(phi[0, i] * cycle)
    output["Inbound_phi_" + str(i)] = round(phi[1, i] * cycle)
    output["offset_0"] = 0
    output["offset_" + str(i+1)] = round(offset[i]%cycle)

  return output

def callback(phase, phaseID, phaseRed, outbound, inbound, travel_time, queue_time):
  phase = np.array(phase)
  phaseID = np.array(phaseID)
  phaseRed = np.array(phaseRed)
  outbound = np.array(outbound)
  inbound = np.array(inbound)
  travel_time = np.array(travel_time)
  queue_time = np.array(queue_time)

  # Calculate number of junctions
  junctions = len(phase)

  # Calculate cycle length
  cycle_length_1 = cycle_length_2 = cycle_length = 0
  for i in range(len(phase[0][0])):
    cycle_length_1 += phase[0][0][i]
    cycle_length_2 += phase[0][1][i]
  cycle_length = max(cycle_length_1, cycle_length_2)

  # Calculate green time
  phaseGreen = phase - phaseRed
  # Initially assign empty outbound/inbound green time array
  outGreen = np.empty(junctions, dtype = int)
  inGreen = np.empty(junctions, dtype = int)

  # phase [junctions x upper/lower x phase]
  for i in range (junctions):
    # Green = phaseGreen[junctions][upper/lower][index]
    outGreen[i] = phaseGreen[i][np.where(phaseID == outbound[i])[1][i]][np.where(phaseID == outbound[i])[2][i]]
    inGreen[i] = phaseGreen[i][np.where(phaseID == inbound[i])[1][i]][np.where(phaseID == inbound[i])[2][i]]

  # Ring and barrier to determine RightTurn phase number
  ringBarrier = dict([(1, 2), (2, 1), (3, 4), (4, 3), (5, 6), (6, 5), (7, 8), (8, 7)])
  outRight = np.empty(junctions, dtype = int)
  inRight = np.empty(junctions, dtype = int)

  for i in range (junctions):
    # RightTurnTime = phase[junctions][outbound/inbound][index]
    outRight[i] = phase[i][np.where(phaseID == ringBarrier[inbound[i]])[1][i]][np.where(phaseID == ringBarrier[inbound[i]])[2][i]]
    inRight[i] = phase[i][np.where(phaseID == ringBarrier[outbound[i]])[1][i]][np.where(phaseID == ringBarrier[outbound[i]])[2][i]]

  # Calculate red time
  red_time = np.empty([2, junctions], dtype = int)

  for i in range (junctions):
    red_time[0][i] = cycle_length - outGreen[i]
    red_time[1][i] = cycle_length - inGreen[i]

  # Determine pattern
  def determine_lead_lag(outbound, inbound, phaseID):
      lead_lag_status = []

      for i in range(len(outbound)):
          # Get the last dimension of the phase IDs for outbound and inbound
          outbound_last_dim = np.where(phaseID[i] == outbound[i])[-1]
          inbound_last_dim = np.where(phaseID[i] == inbound[i])[-1]

          # Compare the last dimension indices
          if outbound_last_dim < inbound_last_dim:
              status = "leading"#pattern 1
          elif outbound_last_dim > inbound_last_dim:
              status = "lagging"#pattern 2 
          elif outbound_last_dim == inbound_last_dim == 0 or outbound_last_dim == inbound_last_dim == 2:#if outbound and inbound at front of ring and barrier
              status = "lag-lag"#pattern 4
          else:
              status = "lead-lead"#pattern 3

          lead_lag_status.append(status)

      return lead_lag_status

  # Determine lead/lag status using the function
  lead_lag_status = determine_lead_lag(outbound, inbound, phaseID)

  intraoff=np.empty(junctions, dtype = int)
  for i in range (junctions):
    if lead_lag_status[i] == "leading" or lead_lag_status[i] == "lagging":
       intraoff[i] = 1/2 * inGreen[i]+ outRight[i] - 1/2 * outGreen[i]
       if lead_lag_status[i] == "leading":
          intraoff[i] = -intraoff[i]
    elif lead_lag_status[i] == "lag-lag": #pattern 4
       intraoff[i] = 1/2 * outGreen[i] - 1/2 * inGreen[i] #which shorter means to left of center of other direction if outbound left means -
    else: # pattern 3
       intraoff[i] = 1/2 * inGreen[i] - 1/2 * outGreen[i] #which longer means to left of center of other direction if outbound left means -
    
  queue_time = np.maximum(queue_time - 6, 0)
  # ~~~ Calling MILP1 ~~~
  # Convert to unit in cycles
  t = travel_time / cycle_length
  delta = intraoff / cycle_length
  r = red_time / cycle_length
  tao = queue_time / cycle_length

  output = milp1(junctions, t, delta, r, tao, cycle_length)
  return output